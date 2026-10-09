"""Voice Library — built-in engine voices and user profiles in one list,
with favourites, bundled avatars and audio previews."""

import asyncio
import json
import logging
import re
import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from .. import config, models
from ..database import ProfileSample as DBProfileSample
from ..database import VoiceFavorite as DBVoiceFavorite
from ..database import VoiceProfile as DBVoiceProfile
from ..database import get_db
from ..services import profiles as profiles_service
from ..services import voice_catalog

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/voices", tags=["voices"])

PREVIEW_TEXTS = {
    "en": "Hi, I'm {name}. This is how I sound reading your text aloud.",
    "es": "Hola, soy {name}. Así sueno cuando leo tu texto en voz alta.",
    "fr": "Bonjour, je suis {name}. Voici ma voix quand je lis votre texte.",
    "it": "Ciao, sono {name}. Ecco come suono quando leggo il tuo testo.",
    "pt": "Olá, eu sou {name}. É assim que eu soo lendo o seu texto.",
    "hi": "नमस्ते, मैं {name} हूँ। आपका पाठ पढ़ते हुए मेरी आवाज़ ऐसी लगती है।",
    "ja": "こんにちは、{name}です。あなたの文章をこんな声で読み上げます。",
    "zh": "你好，我是{name}。这就是我朗读你的文字时的声音。",
    "ko": "안녕하세요, 저는 {name}입니다. 제가 글을 읽으면 이런 목소리예요.",
}

_SAFE_FILENAME = re.compile(r"^[a-z0-9_\-]+\.webp$")
_preview_locks: dict[str, asyncio.Lock] = {}


def _preset_key(engine: str, voice_id: str) -> str:
    return f"preset:{engine}:{voice_id}"


def _profile_key(profile_id: str) -> str:
    return f"profile:{profile_id}"


def _avatar_url(filename: Optional[str]) -> Optional[str]:
    return f"/voices/avatars/{filename}" if filename else None


def _profile_tags(profile: DBVoiceProfile) -> list[str]:
    try:
        tags = json.loads(profile.tags) if profile.tags else []
        return [str(t) for t in tags] if isinstance(tags, list) else []
    except ValueError:
        return []


def _claimed_preset_profiles(db: Session) -> dict[tuple[str, str], DBVoiceProfile]:
    """Oldest preset profile per (engine, voice_id) — that profile *is* the
    catalog entry; any other preset profiles show as the user's own voices."""
    claimed: dict[tuple[str, str], DBVoiceProfile] = {}
    rows = (
        db.query(DBVoiceProfile)
        .filter(DBVoiceProfile.voice_type == "preset")
        .order_by(DBVoiceProfile.created_at.asc())
        .all()
    )
    for p in rows:
        k = (p.preset_engine, p.preset_voice_id)
        if k not in claimed:
            claimed[k] = p
    return claimed


def _is_compatible(profile: DBVoiceProfile, engine: Optional[str]) -> bool:
    if (profile.voice_type or "cloned") == "import":
        return False
    if engine is None:
        return True
    try:
        profiles_service.validate_profile_engine(profile, engine)
        return True
    except ValueError:
        return False


# ── Listing ──────────────────────────────────────────────────────────


@router.get("", response_model=models.LibraryVoiceListResponse)
async def list_voices(engine: Optional[str] = Query(None), db: Session = Depends(get_db)):
    favorites = {row.key for row in db.query(DBVoiceFavorite).all()}
    claimed = _claimed_preset_profiles(db)
    claimed_ids = {p.id for p in claimed.values()}
    sample_counts = {
        pid for (pid,) in db.query(DBProfileSample.profile_id).distinct().all()
    }

    voices: list[models.LibraryVoice] = []

    # User profiles first — they're what people reach for most.
    profiles = db.query(DBVoiceProfile).order_by(DBVoiceProfile.created_at.desc()).all()
    for p in profiles:
        if p.id in claimed_ids or not _is_compatible(p, engine):
            continue
        voice_type = p.voice_type or "cloned"
        catalog_entry = (
            voice_catalog.get_catalog_voice(p.preset_engine, p.preset_voice_id)
            if voice_type == "preset"
            else None
        )
        avatar_url = f"/profiles/{p.id}/avatar" if p.avatar_path else (
            _avatar_url(catalog_entry.avatar) if catalog_entry else None
        )
        voices.append(
            models.LibraryVoice(
                key=_profile_key(p.id),
                kind="profile",
                name=p.name,
                engine=p.preset_engine or p.default_engine,
                voice_id=p.preset_voice_id,
                profile_id=p.id,
                voice_type=voice_type,
                gender=p.gender or (catalog_entry.gender if catalog_entry else None),
                language=p.language or "en",
                locale=catalog_entry.locale if catalog_entry else None,
                accent=catalog_entry.accent if catalog_entry else None,
                styles=_profile_tags(p) or (list(catalog_entry.styles) if catalog_entry else []),
                description=p.description,
                avatar_url=avatar_url,
                favorite=_profile_key(p.id) in favorites,
                has_preview=voice_type == "preset" or p.id in sample_counts,
            )
        )

    for v in voice_catalog.list_catalog_voices(engine):
        profile = claimed.get((v.engine, v.voice_id))
        avatar_url = (
            f"/profiles/{profile.id}/avatar" if profile is not None and profile.avatar_path else _avatar_url(v.avatar)
        )
        voices.append(
            models.LibraryVoice(
                key=v.key,
                kind="preset",
                name=v.name,
                engine=v.engine,
                voice_id=v.voice_id,
                profile_id=profile.id if profile else None,
                voice_type="preset",
                gender=v.gender,
                language=v.language,
                locale=v.locale,
                accent=v.accent,
                age=v.age,
                styles=list(v.styles),
                description=v.description,
                avatar_url=avatar_url,
                favorite=v.key in favorites,
                has_preview=True,
            )
        )

    return models.LibraryVoiceListResponse(voices=voices)


@router.get("/avatars/{filename}")
async def get_voice_avatar(filename: str):
    if not _SAFE_FILENAME.match(filename):
        raise HTTPException(status_code=404, detail="Avatar not found")
    path = voice_catalog.avatars_dir() / filename
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Avatar not found")
    return FileResponse(path, media_type="image/webp", headers={"Cache-Control": "public, max-age=604800"})


# ── Activation ───────────────────────────────────────────────────────


def _unique_profile_name(db: Session, base: str, qualifier: str) -> str:
    candidates = [base, f"{base} ({qualifier})"]
    for name in candidates:
        if not db.query(DBVoiceProfile).filter_by(name=name).first():
            return name
    i = 2
    while db.query(DBVoiceProfile).filter_by(name=f"{base} ({qualifier}) {i}").first():
        i += 1
    return f"{base} ({qualifier}) {i}"


@router.post("/activate", response_model=models.ActivateVoiceResponse)
async def activate_voice(data: models.ActivateVoiceRequest, db: Session = Depends(get_db)):
    """Return the profile backing a built-in voice, creating it on first use.

    Generation and history are keyed by profile, so a built-in voice gets a
    lightweight ``voice_type="preset"`` profile the first time it's picked.
    """
    entry = voice_catalog.get_catalog_voice(data.engine, data.voice_id)
    if entry is None:
        raise HTTPException(status_code=404, detail=f"Unknown voice '{data.voice_id}' for engine '{data.engine}'")

    existing = _claimed_preset_profiles(db).get((data.engine, data.voice_id))
    if existing is not None:
        return models.ActivateVoiceResponse(profile_id=existing.id, created=False)

    from ..backends import TTS_ENGINES

    name = _unique_profile_name(db, entry.name, f"{TTS_ENGINES.get(entry.engine, entry.engine)} {entry.accent}")
    try:
        profile = await profiles_service.create_profile(
            models.VoiceProfileCreate(
                name=name,
                description=entry.description or f"{entry.accent} · {entry.gender.capitalize()}",
                language=entry.language,
                voice_type="preset",
                preset_engine=entry.engine,
                preset_voice_id=entry.voice_id,
            ),
            db,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    row = db.query(DBVoiceProfile).filter_by(id=profile.id).first()
    if row is not None:
        row.gender = entry.gender
        row.tags = json.dumps(list(entry.styles))
        db.commit()

    return models.ActivateVoiceResponse(profile_id=profile.id, created=True)


# ── Favourites ───────────────────────────────────────────────────────


@router.put("/favorites/{key:path}")
async def add_favorite(key: str, db: Session = Depends(get_db)):
    if not (key.startswith("preset:") or key.startswith("profile:")):
        raise HTTPException(status_code=400, detail="Invalid voice key")
    if not db.query(DBVoiceFavorite).filter_by(key=key).first():
        db.add(DBVoiceFavorite(key=key, created_at=datetime.utcnow()))
        db.commit()
    return {"key": key, "favorite": True}


@router.delete("/favorites/{key:path}")
async def remove_favorite(key: str, db: Session = Depends(get_db)):
    db.query(DBVoiceFavorite).filter_by(key=key).delete()
    db.commit()
    return {"key": key, "favorite": False}


# ── Previews ─────────────────────────────────────────────────────────


def _preview_path(engine: str, voice_id: str):
    safe = re.sub(r"[^A-Za-z0-9_\-]", "_", voice_id)
    directory = config.get_cache_dir() / "voice_previews" / engine
    directory.mkdir(parents=True, exist_ok=True)
    return directory / f"{safe}.wav"


from ..services.inference_runtime import qwen_job


@qwen_job
async def _render_preset_preview(engine: str, voice_id: str, name: str, language: str) -> bytes:
    from ..backends import get_tts_backend_for_engine, load_engine_model
    from ..services import tts
    from ..utils.audio import normalize_loudness_broadcast

    backend = get_tts_backend_for_engine(engine)
    await load_engine_model(engine, _preview_model_size(engine, backend))
    text = PREVIEW_TEXTS.get(language, PREVIEW_TEXTS["en"]).format(name=name)
    voice_prompt = {"voice_type": "preset", "preset_engine": engine, "preset_voice_id": voice_id}
    audio, sr = await backend.generate(text, voice_prompt, language if language in PREVIEW_TEXTS else "en", 42, None)
    audio = normalize_loudness_broadcast(audio, sr, -20.0)
    return tts.audio_to_wav_bytes(audio, sr)


def _preview_model_size(engine: str, backend) -> str:
    """Use whatever size is loaded or downloaded — never trigger a download."""
    if engine != "qwen_custom_voice":
        return "default"
    loaded = getattr(backend, "_current_model_size", None) or getattr(backend, "model_size", None)
    if backend.is_loaded() and loaded:
        return loaded
    return "0.6B" if backend._is_model_cached("0.6B") else "1.7B"


def _preview_model_ready(engine: str) -> bool:
    from ..backends import get_tts_backend_for_engine

    backend = get_tts_backend_for_engine(engine)
    try:
        if engine == "qwen_custom_voice":
            return backend._is_model_cached("0.6B") or backend._is_model_cached("1.7B")
        return backend._is_model_cached()
    except Exception:
        return False


@router.get("/preview")
async def get_voice_preview(
    engine: Optional[str] = None,
    voice_id: Optional[str] = None,
    profile_id: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """A short audio sample of a voice.

    Built-in voices play their bundled clip; if none ships, one is
    synthesized once and cached. Cloned voices play their first reference
    sample.
    """
    if profile_id:
        profile = db.query(DBVoiceProfile).filter_by(id=profile_id).first()
        if profile is None:
            raise HTTPException(status_code=404, detail="Profile not found")
        if (profile.voice_type or "cloned") == "preset":
            engine, voice_id = profile.preset_engine, profile.preset_voice_id
        else:
            sample = db.query(DBProfileSample).filter_by(profile_id=profile_id).first()
            path = config.resolve_storage_path(sample.audio_path) if sample else None
            if path is None or not path.exists():
                raise HTTPException(status_code=404, detail="This voice has no reference sample to preview")
            return FileResponse(path, media_type="audio/wav")

    if not engine or not voice_id:
        raise HTTPException(status_code=400, detail="Pass engine and voice_id, or profile_id")

    entry = voice_catalog.get_catalog_voice(engine, voice_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="Unknown voice")

    # Shipped clip first — works offline and before the model is downloaded.
    bundled = voice_catalog.bundled_sample(engine, voice_id)
    if bundled is not None:
        return FileResponse(bundled, media_type="audio/mpeg", headers={"Cache-Control": "public, max-age=604800"})

    path = _preview_path(engine, voice_id)
    if path.exists() and path.stat().st_size > 0:
        return FileResponse(path, media_type="audio/wav", headers={"Cache-Control": "public, max-age=86400"})

    if not _preview_model_ready(engine):
        raise HTTPException(
            status_code=409,
            detail="Download this model to preview its voices.",
        )

    lock = _preview_locks.setdefault(f"{engine}:{voice_id}", asyncio.Lock())
    async with lock:
        if not path.exists():
            from ..services.task_queue import run_serialized

            try:
                wav = await run_serialized(
                    f"preview-{uuid.uuid4()}",
                    lambda: _render_preset_preview(engine, voice_id, entry.name, entry.language),
                )
            except Exception as e:
                logger.exception("Preview generation failed for %s/%s", engine, voice_id)
                raise HTTPException(status_code=500, detail=f"Preview failed: {e}") from e
            tmp = path.with_suffix(".tmp")
            tmp.write_bytes(wav)
            tmp.replace(path)

    return FileResponse(path, media_type="audio/wav", headers={"Cache-Control": "public, max-age=86400"})
