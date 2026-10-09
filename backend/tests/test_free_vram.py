"""free_vram_for: unload other resident models only when CUDA memory is short."""

import pytest

torch = pytest.importorskip("torch")

from backend import backends  # noqa: E402


class _FakeBackend:
    def __init__(self):
        self.loaded = True

    def is_loaded(self):
        return self.loaded

    def unload_model(self):
        self.loaded = False


@pytest.fixture
def resident(monkeypatch):
    kokoro, qwen_cv = _FakeBackend(), _FakeBackend()
    monkeypatch.setattr(backends, "_tts_backends", {"kokoro": kokoro, "qwen_custom_voice": qwen_cv})
    monkeypatch.setattr(backends, "_stt_backend", None)
    monkeypatch.setattr(backends, "_llm_backends", {})
    monkeypatch.setattr(backends, "get_tts_backend_for_engine", lambda engine: backends._tts_backends[engine])
    monkeypatch.setattr(torch.cuda, "is_available", lambda: True)
    monkeypatch.setattr(torch.cuda, "empty_cache", lambda: None)
    return kokoro, qwen_cv


def _free(monkeypatch, mb):
    monkeypatch.setattr(torch.cuda, "mem_get_info", lambda *a: (mb * 1024 * 1024, 4096 * 1024 * 1024))


def test_keeps_other_models_when_there_is_room(resident, monkeypatch):
    kokoro, _ = resident
    _free(monkeypatch, 3500)
    assert backends.free_vram_for("qwen_custom_voice", 3000) == []
    assert kokoro.loaded


def test_unloads_other_models_but_not_the_requesting_engine(resident, monkeypatch):
    kokoro, qwen_cv = resident
    _free(monkeypatch, 1500)
    assert backends.free_vram_for("qwen_custom_voice", 3000) == ["kokoro"]
    assert not kokoro.loaded
    assert qwen_cv.loaded
