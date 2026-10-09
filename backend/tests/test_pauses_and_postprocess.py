"""Pause tags, speed, silence removal and loudness normalization."""

import numpy as np
import pytest

from backend.models import PostprocessingOptions, PreprocessingOptions
from backend.services.render import render_speech
from backend.utils.audio import apply_speed, normalize_loudness_broadcast, remove_silence
from backend.utils.pauses import MAX_PAUSE_MS, silence, split_on_pauses

SR = 16000


# ── Pause parsing ────────────────────────────────────────────────────


def test_split_on_pauses_units_and_merge():
    assert split_on_pauses("Hello <500ms> world<1s><0.5s>end") == [
        ("text", "Hello"),
        ("pause", 500),
        ("text", "world"),
        ("pause", 1500),
        ("text", "end"),
    ]


def test_pause_is_capped():
    assert split_on_pauses("a <999s> b")[1] == ("pause", MAX_PAUSE_MS)


def test_leading_and_trailing_pauses_kept():
    assert split_on_pauses("<1s>Hi<2s>") == [("pause", 1000), ("text", "Hi"), ("pause", 2000)]


def test_sentence_pauses_skip_abbreviations_and_final_sentence():
    segments = split_on_pauses("Dr. Smith arrived. He sat down! Done", sentence_pause_ms=300)
    assert segments == [
        ("text", "Dr. Smith arrived."),
        ("pause", 300),
        ("text", "He sat down!"),
        ("pause", 300),
        ("text", "Done"),
    ]


def test_silence_length():
    assert len(silence(250, SR)) == SR // 4


# ── Audio helpers ────────────────────────────────────────────────────


def _tone(seconds: float, amp: float = 0.3) -> np.ndarray:
    t = np.arange(int(SR * seconds)) / SR
    return (amp * np.sin(2 * np.pi * 220 * t)).astype(np.float32)


def test_apply_speed_changes_duration():
    audio = _tone(2.0)
    faster = apply_speed(audio, SR, 2.0)
    assert abs(len(faster) - len(audio) / 2) < SR * 0.05
    assert apply_speed(audio, SR, 1.0) is audio


def test_remove_silence_trims_edges_and_long_gaps():
    gap = np.zeros(SR * 2, dtype=np.float32)
    audio = np.concatenate([gap, _tone(0.5), gap, _tone(0.5), gap])
    out = remove_silence(audio, SR, max_gap_ms=300)
    # two 0.5s tones + one capped gap (~0.3s) + small padding
    assert len(out) < SR * 1.6
    assert len(out) > SR * 1.2


def test_broadcast_loudness_hits_target_with_peak_ceiling():
    import pyloudnorm as pyln

    audio = _tone(3.0, amp=0.05)
    out = normalize_loudness_broadcast(audio, SR, target_lufs=-16.0)
    measured = pyln.Meter(SR).integrated_loudness(out.astype(np.float64))
    assert measured == pytest.approx(-16.0, abs=0.5)
    assert np.max(np.abs(out)) <= 10 ** (-1 / 20) + 1e-6


def test_broadcast_loudness_with_transients_is_limited_without_makeup_gain():
    """Peaky audio must hit the ceiling via limiting, and loudness must not
    overshoot the target (regression: pedalboard's Limiter added make-up gain)."""
    import pyloudnorm as pyln

    audio = _tone(3.0, amp=0.05)
    audio[:: SR // 10] = 0.9  # sharp clicks every 100 ms → high crest factor
    out = normalize_loudness_broadcast(audio, SR, target_lufs=-16.0)
    measured = pyln.Meter(SR).integrated_loudness(out.astype(np.float64))
    assert np.max(np.abs(out)) <= 10 ** (-1 / 20) + 1e-6
    assert -17.0 <= measured <= -15.8


def test_peak_limit_leaves_quiet_audio_untouched():
    from backend.utils.audio import peak_limit

    audio = _tone(1.0, amp=0.1)
    assert np.allclose(peak_limit(audio, SR, 10 ** (-1 / 20)), audio)


# ── End-to-end render pipeline with a fake engine ────────────────────


class FakeBackend:
    def __init__(self):
        self.calls = []

    async def generate(self, text, voice_prompt, language, seed, instruct, **kwargs):
        self.calls.append((text, seed, kwargs))
        return _tone(1.0), SR


async def test_render_inserts_exact_pauses_and_preprocesses():
    backend = FakeBackend()
    audio, sr = await render_speech(
        backend,
        engine="qwen",
        text="Hello[1] <1s> world",
        voice_prompt={},
        language="en",
        seed=7,
        preprocessing=PreprocessingOptions(),
        postprocessing=PostprocessingOptions(loudness="off"),
    )
    assert sr == SR
    assert [c[0] for c in backend.calls] == ["Hello", "world"]
    assert [c[1] for c in backend.calls] == [7, 1007]
    assert len(audio) == SR * 3  # 1s speech + 1s pause + 1s speech
    assert not np.any(audio[SR : 2 * SR])


async def test_render_native_speed_is_forwarded_for_kokoro():
    backend = FakeBackend()
    await render_speech(
        backend, engine="kokoro", text="Hi", voice_prompt={}, language="en", speed=1.5,
        postprocessing=PostprocessingOptions(loudness="off"),
    )
    assert backend.calls[0][2] == {"speed": 1.5}


async def test_render_stretches_engines_without_native_speed():
    backend = FakeBackend()
    audio, _ = await render_speech(
        backend, engine="qwen", text="Hi", voice_prompt={}, language="en", speed=2.0,
        postprocessing=PostprocessingOptions(loudness="off"),
    )
    assert backend.calls[0][2] == {}
    assert abs(len(audio) - SR / 2) < SR * 0.05


async def test_render_rejects_pause_only_text():
    with pytest.raises(ValueError, match="Nothing to speak"):
        await render_speech(FakeBackend(), engine="qwen", text="<1s>", voice_prompt={}, language="en")
