"""
The speech render pipeline shared by every generation path.

    preprocess text → split on pause tags → synthesize each speech segment
    (chunked) → speed → remove silence → join with exact pauses → loudness

Effects chains are applied by the caller afterwards, because /generate
stores the clean and processed takes as separate versions.
"""

from __future__ import annotations

import logging
from typing import Optional

import numpy as np

logger = logging.getLogger("voicebox.render")

# Offset between speech segments' seeds, so segments stay deterministic
# without sharing chunk seeds (generate_chunked adds the chunk index).
_SEGMENT_SEED_STRIDE = 1000


from .inference_runtime import qwen_job


@qwen_job
async def render_request(backend, *, engine, model_size, **kwargs):
    """Non-persisting request boundary with an immutable execution snapshot."""
    from ..backends import load_engine_model
    await load_engine_model(engine, model_size)
    return await render_speech(backend, engine=engine, **kwargs)


async def render_speech(
    backend,
    *,
    engine: str,
    text: str,
    voice_prompt: dict,
    language: str,
    seed: Optional[int] = None,
    instruct: Optional[str] = None,
    max_chunk_chars: Optional[int] = None,
    crossfade_ms: Optional[int] = None,
    speed: Optional[float] = None,
    preprocessing=None,
    postprocessing=None,
) -> tuple[np.ndarray, int]:
    from ..backends import engine_needs_trim, engine_retries_runaway, get_engine_info
    from ..utils.audio import (
        apply_postprocessing,
        apply_speed,
        has_tts_runaway,
        remove_silence,
        trim_tts_output,
    )
    from ..utils.chunked_tts import concatenate_audio_chunks, generate_chunked
    from ..utils.pauses import silence, split_on_pauses
    from ..utils.text_preprocess import preprocess_text

    text = preprocess_text(text, preprocessing, language)
    sentence_pause_ms = getattr(preprocessing, "sentence_pause_ms", 0) if preprocessing else 0
    segments = split_on_pauses(text, sentence_pause_ms)
    if not any(kind == "text" for kind, _ in segments):
        raise ValueError("Nothing to speak after preprocessing — the text only contains pauses or tags.")

    info = get_engine_info(engine)
    native_speed = bool(info and info.native_speed)
    speed = float(speed) if speed is not None else 1.0
    stretch = not native_speed and abs(speed - 1.0) > 1e-3
    strip_silence = bool(getattr(postprocessing, "remove_silence", False))

    gen_kwargs: dict = dict(
        language=language,
        instruct=instruct,
        trim_fn=trim_tts_output if engine_needs_trim(engine) else None,
        runaway_detector=has_tts_runaway if engine_retries_runaway(engine) else None,
    )
    if max_chunk_chars is not None:
        gen_kwargs["max_chunk_chars"] = max_chunk_chars
    if crossfade_ms is not None:
        gen_kwargs["crossfade_ms"] = crossfade_ms
    if native_speed and abs(speed - 1.0) > 1e-3:
        gen_kwargs["speed"] = speed

    # Speech segments are synthesized first; pauses need the sample rate.
    rendered: list[tuple[str, object]] = []
    sample_rate: Optional[int] = None
    speech_index = 0
    for kind, value in segments:
        if kind == "pause":
            rendered.append(("pause", value))
            continue
        segment_seed = seed + speech_index * _SEGMENT_SEED_STRIDE if seed is not None else None
        speech_index += 1
        audio, sr = await generate_chunked(backend, str(value), voice_prompt, seed=segment_seed, **gen_kwargs)
        if stretch:
            audio = apply_speed(audio, sr, speed)
        if strip_silence:
            audio = remove_silence(audio, sr)
        sample_rate = sample_rate or sr
        rendered.append(("audio", np.asarray(audio, dtype=np.float32)))

    assert sample_rate is not None

    if len(segments) == 1:
        audio = rendered[0][1]
    else:
        # Crossfade only matters between chunks inside a segment; segments
        # are joined with a hard cut so pauses are exact.
        pieces = [
            silence(int(value), sample_rate) if kind == "pause" else value
            for kind, value in rendered
        ]
        audio = concatenate_audio_chunks(pieces, sample_rate, crossfade_ms=0)

    if engine == "qwen_custom_voice":
        from .inference_runtime import publish
        publish(stage="postprocessing")
    audio = apply_postprocessing(audio, sample_rate, postprocessing)
    return audio, sample_rate
