"""Voice Library catalog and engine registry metadata."""

import pytest

from backend.backends import TTS_ENGINE_INFO, TTS_ENGINES, get_tts_model_configs
from backend.services import voice_catalog


# The catalog reads the Qwen CustomVoice speaker list, whose backend module
# imports torch at load time.
@pytest.fixture
def backend_voices():
    pytest.importorskip("torch")
    from backend.backends.kokoro_backend import KOKORO_VOICES
    from backend.backends.qwen_custom_voice_backend import QWEN_CUSTOM_VOICES

    return KOKORO_VOICES, QWEN_CUSTOM_VOICES


def test_every_engine_has_ui_metadata_and_models():
    assert set(TTS_ENGINE_INFO) == set(TTS_ENGINES)
    engines_with_models = {c.engine for c in get_tts_model_configs()}
    assert set(TTS_ENGINE_INFO) <= engines_with_models


def test_catalog_covers_backend_voice_lists_exactly(backend_voices):
    KOKORO_VOICES, QWEN_CUSTOM_VOICES = backend_voices
    kokoro_ids = {v.voice_id for v in voice_catalog.list_catalog_voices("kokoro")}
    assert kokoro_ids == {vid for vid, *_ in KOKORO_VOICES}
    qwen_ids = {v.voice_id for v in voice_catalog.list_catalog_voices("qwen_custom_voice")}
    assert qwen_ids == {vid for vid, *_ in QWEN_CUSTOM_VOICES}


def test_british_voices_are_labelled_british(backend_voices):
    emma = voice_catalog.get_catalog_voice("kokoro", "bf_emma")
    assert emma is not None
    assert emma.accent == "British English"
    assert emma.locale == "en-GB"
    assert emma.key == "preset:kokoro:bf_emma"


def test_catalog_avatars_exist_on_disk(backend_voices):
    directory = voice_catalog.avatars_dir()
    for v in voice_catalog.list_catalog_voices():
        if v.avatar:
            assert (directory / v.avatar).is_file(), v.avatar
