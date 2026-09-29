#!/usr/bin/env python3
"""
Render the bundled preview clip for every built-in voice.

The official Kokoro and Qwen3-TTS repos don't publish per-voice samples, so
we synthesize one clip per voice with the official models — same sentence
for every voice in its language, so they're easy to compare. Clips are
loudness-normalized and stored as small MP3s under backend/voices/samples/,
which the /voices/preview endpoint serves before falling back to live
synthesis. The app never generates these at runtime.

    python scripts/build_voice_samples.py                 # all engines
    python scripts/build_voice_samples.py --engine kokoro --force

Needs the backend's Python deps and the models in the HF cache
(Kokoro-82M, Qwen3-TTS CustomVoice 0.6B or 1.7B).
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

SAMPLES_DIR = REPO_ROOT / "backend" / "voices" / "samples"
TARGET_LUFS = -18.0


async def render(engine: str, force: bool) -> dict[str, str]:
    import numpy as np
    import soundfile as sf

    from backend.backends import get_tts_backend_for_engine, load_engine_model
    from backend.routes.voices import PREVIEW_TEXTS
    from backend.services.voice_catalog import list_catalog_voices
    from backend.utils.audio import normalize_loudness_broadcast, remove_silence

    backend = get_tts_backend_for_engine(engine)
    size = "default"
    if engine == "qwen_custom_voice":
        size = "0.6B" if backend._is_model_cached("0.6B") else "1.7B"
    await load_engine_model(engine, size)

    written: dict[str, str] = {}
    for voice in list_catalog_voices(engine):
        filename = f"{engine}_{voice.voice_id}.mp3".lower()
        path = SAMPLES_DIR / filename
        key = f"{engine}:{voice.voice_id}"
        if path.exists() and not force:
            written[key] = filename
            continue
        lang = voice.language if voice.language in PREVIEW_TEXTS else "en"
        text = PREVIEW_TEXTS[lang].format(name=voice.name)
        prompt = {"voice_type": "preset", "preset_engine": engine, "preset_voice_id": voice.voice_id}
        try:
            audio, sr = await backend.generate(text, prompt, lang, 42, None)
        except Exception as e:  # keep going; a missing clip falls back to live synthesis
            print(f"  ✗ {key}: {e}", file=sys.stderr)
            continue
        audio = remove_silence(np.asarray(audio, dtype=np.float32), sr)
        audio = normalize_loudness_broadcast(audio, sr, TARGET_LUFS)
        sf.write(path, audio, sr, format="MP3", bitrate_mode="VARIABLE", compression_level=0.6)
        written[key] = filename
        print(f"  ✓ {key}  {len(audio) / sr:.1f}s  {path.stat().st_size // 1024} KB")
    return written


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--engine", choices=["kokoro", "qwen_custom_voice"], action="append")
    parser.add_argument("--force", action="store_true", help="re-render clips that already exist")
    args = parser.parse_args()

    SAMPLES_DIR.mkdir(parents=True, exist_ok=True)
    manifest_path = SAMPLES_DIR / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else {}

    for engine in args.engine or ["kokoro", "qwen_custom_voice"]:
        print(f"{engine}:")
        manifest.update(asyncio.run(render(engine, args.force)))

    manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"{len(manifest)} samples in {SAMPLES_DIR}")


if __name__ == "__main__":
    main()
