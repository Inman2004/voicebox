"""Gallery support on /history: filters, sorting, grouping, facets, bulk actions, ZIP export."""

import io
import uuid
import zipfile
from datetime import datetime, timedelta

import numpy as np
import pytest
import soundfile as sf
from fastapi import FastAPI
from fastapi.testclient import TestClient


@pytest.fixture
def env(tmp_path):
    from backend import config
    from backend.database import Generation, VoiceProfile, session

    config.set_data_dir(tmp_path)
    session.init_db()
    db = session.SessionLocal()

    anna = VoiceProfile(id=str(uuid.uuid4()), name="Anna", language="en", voice_type="cloned")
    bob = VoiceProfile(id=str(uuid.uuid4()), name="bob", language="en", voice_type="cloned")
    db.add_all([anna, bob])

    now = datetime.utcnow()
    rows = [
        # (profile, text, engine, lang, status, duration, gen_seconds, favourite, age_days)
        (anna, "Short hello", "kokoro", "en", "completed", 1.0, 0.5, True, 0),
        (anna, "A much longer sentence here", "qwen", "en", "completed", 9.0, 4.0, False, 1),
        (bob, "Hola mundo", "kokoro", "es", "completed", 3.0, None, False, 2),
        (bob, "Broken one", "qwen", "en", "failed", None, None, False, 3),
        (bob, "Still going", "kokoro", "en", "generating", None, None, False, 0),
    ]
    ids = []
    for i, (profile, text, engine, lang, status, dur, gen_s, fav, age) in enumerate(rows):
        gid = str(uuid.uuid4())
        audio_path = None
        if status == "completed":
            path = config.get_generations_dir() / f"{gid}.wav"
            sf.write(path, np.zeros(1600, dtype=np.float32), 16000)
            audio_path = config.to_storage_path(path)
        db.add(
            Generation(
                id=gid,
                profile_id=profile.id,
                text=text,
                language=lang,
                engine=engine,
                status=status,
                duration=dur,
                generation_seconds=gen_s,
                is_favorited=fav,
                audio_path=audio_path,
                created_at=now - timedelta(days=age, minutes=i),
            )
        )
        ids.append(gid)
    db.commit()
    db.close()

    import backend.app  # noqa: F401 — routes.history imports from app; load it first like the server does
    from backend.routes import history

    app = FastAPI()
    app.include_router(history.router)
    return TestClient(app), ids


def _texts(client, **params):
    return [g["text"] for g in client.get("/history", params=params).json()["items"]]


def test_filters(env):
    client, _ = env
    assert _texts(client, engine="kokoro", status="completed") == ["Short hello", "Hola mundo"]
    assert _texts(client, language="es") == ["Hola mundo"]
    assert _texts(client, favorites_only=True) == ["Short hello"]
    assert _texts(client, status="failed") == ["Broken one"]
    assert _texts(client, status="in_progress") == ["Still going"]
    # search matches voice names as well as text
    assert set(_texts(client, search="bob")) == {"Hola mundo", "Broken one", "Still going"}


def test_sorting_puts_missing_values_last(env):
    client, _ = env
    assert _texts(client, sort_by="duration", order="desc")[:3] == [
        "A much longer sentence here",
        "Hola mundo",
        "Short hello",
    ]
    assert _texts(client, sort_by="duration", order="asc")[:3] == [
        "Short hello",
        "Hola mundo",
        "A much longer sentence here",
    ]
    assert _texts(client, sort_by="generation_seconds", order="asc")[:2] == [
        "Short hello",
        "A much longer sentence here",
    ]


def test_group_by_profile_keeps_groups_contiguous(env):
    client, _ = env
    items = client.get("/history", params={"group_by": "profile", "sort_by": "duration"}).json()["items"]
    names = [g["profile_name"] for g in items]
    assert names == sorted(names, key=str.lower)  # case-insensitive grouping


def test_pagination_is_stable(env):
    client, _ = env
    seen = []
    for offset in range(0, 5, 2):
        seen += [g["id"] for g in client.get("/history", params={"limit": 2, "offset": offset}).json()["items"]]
    assert len(seen) == len(set(seen)) == 5


def test_facets_exclude_own_dimension(env):
    client, _ = env
    facets = client.get("/history/facets", params={"engine": "kokoro"}).json()
    assert facets["total"] == 3
    # engine facet ignores the engine filter itself
    assert {e["value"]: e["count"] for e in facets["engines"]} == {"kokoro": 3, "qwen": 2}
    assert {s["value"]: s["count"] for s in facets["statuses"]} == {"completed": 2, "in_progress": 1}
    assert facets["favorites"] == 1
    assert facets["total_duration_seconds"] == pytest.approx(4.0)


def test_bulk_favorite_and_delete(env):
    client, ids = env
    res = client.post("/history/bulk", json={"ids": ids[1:3], "action": "favorite"}).json()
    assert res["affected"] == 2
    assert len(_texts(client, favorites_only=True)) == 3

    res = client.post("/history/bulk", json={"ids": [ids[3], "missing-id"], "action": "delete"}).json()
    assert res["affected"] == 1
    assert "Broken one" not in _texts(client)


def test_export_zip_skips_rows_without_audio(env):
    client, ids = env
    res = client.post("/history/export-zip", json={"ids": ids})
    assert res.status_code == 200
    names = zipfile.ZipFile(io.BytesIO(res.content)).namelist()
    assert len(names) == 3 and all(n.endswith(".wav") for n in names)

    assert client.post("/history/export-zip", json={"ids": [ids[3]]}).status_code == 404


def test_invalid_sort_is_rejected(env):
    client, _ = env
    assert client.get("/history", params={"sort_by": "drop table"}).status_code == 422
