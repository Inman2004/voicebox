"""Voice Library, generation defaults and presets endpoints."""

import pytest

pytest.importorskip("torch")  # the voice catalog reads engine backends that import torch

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402


@pytest.fixture
def client(tmp_path):
    from backend import config
    from backend.database import session

    config.set_data_dir(tmp_path)
    session.init_db()

    from backend.routes import engines, generation_presets, settings, system, voices

    app = FastAPI()
    for module in (engines, voices, generation_presets, settings, system):
        app.include_router(module.router)
    return TestClient(app)


def test_engines_expose_variants_with_languages(client):
    engines = {e["engine"]: e for e in client.get("/engines").json()["engines"]}
    assert engines["kokoro"]["native_speed"] is True
    tada = {v["model_size"]: v for v in engines["tada"]["variants"]}
    assert tada["1B"]["languages"] == ["en"]
    assert len(tada["3B"]["languages"]) > 1


def test_activate_is_idempotent_and_handles_duplicate_names(client):
    first = client.post("/voices/activate", json={"engine": "kokoro", "voice_id": "am_adam"}).json()
    again = client.post("/voices/activate", json={"engine": "kokoro", "voice_id": "am_adam"}).json()
    assert first["created"] is True
    assert again == {"profile_id": first["profile_id"], "created": False}

    # "Santa" exists in several languages — each gets its own profile.
    a = client.post("/voices/activate", json={"engine": "kokoro", "voice_id": "am_santa"})
    b = client.post("/voices/activate", json={"engine": "kokoro", "voice_id": "em_santa"})
    assert a.status_code == b.status_code == 200
    assert a.json()["profile_id"] != b.json()["profile_id"]


def test_activated_voice_is_listed_once_with_profile(client):
    pid = client.post("/voices/activate", json={"engine": "kokoro", "voice_id": "bf_emma"}).json()["profile_id"]
    voices = client.get("/voices", params={"engine": "kokoro"}).json()["voices"]
    emma = [v for v in voices if v["voice_id"] == "bf_emma"]
    assert len(emma) == 1
    assert emma[0]["profile_id"] == pid
    assert emma[0]["accent"] == "British English"
    # Kokoro presets never leak into a cloning engine's list.
    assert client.get("/voices", params={"engine": "qwen"}).json()["voices"] == []


def test_favorites_round_trip(client):
    key = "preset:kokoro:af_heart"
    client.put(f"/voices/favorites/{key}")
    heart = next(v for v in client.get("/voices", params={"engine": "kokoro"}).json()["voices"] if v["key"] == key)
    assert heart["favorite"] is True
    client.delete(f"/voices/favorites/{key}")
    heart = next(v for v in client.get("/voices", params={"engine": "kokoro"}).json()["voices"] if v["key"] == key)
    assert heart["favorite"] is False


def test_preview_requires_downloaded_model(client, monkeypatch):
    from backend.routes import voices
    from backend.services import voice_catalog

    # Bundled clips are served without the model; test the synthesis path.
    monkeypatch.setattr(voice_catalog, "bundled_sample", lambda engine, voice_id: None)
    monkeypatch.setattr(voices, "_preview_model_ready", lambda engine: False)
    res = client.get("/voices/preview", params={"engine": "kokoro", "voice_id": "am_adam"})
    assert res.status_code == 409


def test_settings_round_trip_and_legacy_toggle(client):
    res = client.put(
        "/settings/generation",
        json={
            "speed": 1.25,
            "preprocessing": {"smart_numbers": True, "replacements": [{"from": "AI", "to": "A I"}]},
            "postprocessing": {"loudness": "broadcast", "target_lufs": -18},
        },
    ).json()
    assert res["speed"] == 1.25
    assert res["preprocessing"]["replacements"] == [{"from": "AI", "to": "A I"}]
    assert res["normalize_audio"] is True

    off = client.put("/settings/generation", json={"normalize_audio": False}).json()
    assert off["postprocessing"]["loudness"] == "off"
    assert off["postprocessing"]["target_lufs"] == -18


def test_builtin_presets_are_protected(client):
    presets = client.get("/generation-presets").json()
    assert {"Audiobook", "Podcast", "Fast draft"} <= {p["name"] for p in presets}
    assert client.delete(f"/generation-presets/{presets[0]['id']}").status_code == 400

    mine = client.post("/generation-presets", json={"name": "Mine", "settings": {"speed": 0.8}}).json()
    assert mine["settings"]["speed"] == 0.8
    assert client.post("/generation-presets", json={"name": "Mine", "settings": {}}).status_code == 409
    assert client.delete(f"/generation-presets/{mine['id']}").status_code == 200


def test_system_resources_shape(client):
    data = client.get("/system/resources").json()
    assert "cpu_percent" in data and "loaded_models" in data


def test_defaults_match_the_first_fast_decode_configuration(client):
    res = client.get("/settings/generation").json()
    assert res["postprocessing"]["loudness"] == "broadcast"
    assert res["postprocessing"]["target_lufs"] == -16
    assert res["postprocessing"]["remove_silence"] is False
    assert res["speed"] == 1.0
    assert res["qwen_execution"]["fast_decode"] is True
    assert res["qwen_execution"]["efficient_attention"] is False


def test_legacy_normalize_toggle_restores_broadcast_without_losing_target(client):
    client.put("/settings/generation", json={"postprocessing": {"loudness": "off", "target_lufs": -18}})
    res = client.put("/settings/generation", json={"normalize_audio": True}).json()
    assert res["postprocessing"]["loudness"] == "broadcast"
    assert res["postprocessing"]["target_lufs"] == -18
