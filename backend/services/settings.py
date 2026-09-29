"""
Server-side user settings — singleton rows persisted in SQLite so every
client window, API consumer, and headless flow reads the same preferences.

Two domains live here: capture/refine defaults and long-form generation
defaults. Each has a ``get_*`` that lazily creates the row with defaults and
an ``update_*`` that accepts a partial payload.
"""

from typing import Any

from sqlalchemy.orm import Session

from ..database import CaptureSettings as DBCaptureSettings
from ..database import GenerationSettings as DBGenerationSettings
from ..utils.capture_chords import (
    default_push_to_talk_chord,
    default_toggle_to_talk_chord,
)


SINGLETON_ID = 1


def _get_or_create_capture_row(db: Session) -> DBCaptureSettings:
    row = db.query(DBCaptureSettings).filter(DBCaptureSettings.id == SINGLETON_ID).first()
    if row is None:
        row = DBCaptureSettings(
            id=SINGLETON_ID,
            chord_push_to_talk_keys=default_push_to_talk_chord(),
            chord_toggle_to_talk_keys=default_toggle_to_talk_chord(),
        )
        db.add(row)
        db.commit()
        db.refresh(row)
    return row


def _get_or_create_generation_row(db: Session) -> DBGenerationSettings:
    row = db.query(DBGenerationSettings).filter(DBGenerationSettings.id == SINGLETON_ID).first()
    if row is None:
        row = DBGenerationSettings(id=SINGLETON_ID)
        db.add(row)
        db.commit()
        db.refresh(row)
    return row


def _apply_patch(row: Any, patch: dict[str, Any]) -> None:
    """Apply a partial update to a settings row.

    Values explicitly set to ``None`` are honored only for columns where the
    schema allows it — clearing ``default_playback_voice_id`` works, but a
    ``None`` for a non-nullable field is dropped rather than crashing the
    request. Unknown keys are ignored.
    """
    columns = type(row).__table__.columns
    for key, value in patch.items():
        col = columns.get(key)
        if col is None:
            continue
        if value is None and not col.nullable:
            continue
        setattr(row, key, value)


def get_capture_settings(db: Session) -> DBCaptureSettings:
    """Return the capture settings row, creating it with defaults if missing."""
    return _get_or_create_capture_row(db)


def update_capture_settings(db: Session, patch: dict[str, Any]) -> DBCaptureSettings:
    row = _get_or_create_capture_row(db)
    _apply_patch(row, patch)
    db.commit()
    db.refresh(row)
    return row


def get_generation_settings(db: Session) -> DBGenerationSettings:
    """Return the generation settings row, creating it with defaults if missing."""
    return _get_or_create_generation_row(db)


def update_generation_settings(db: Session, patch: dict[str, Any]) -> DBGenerationSettings:
    row = _get_or_create_generation_row(db)
    _apply_patch(row, patch)
    db.commit()
    db.refresh(row)
    return row


# --- Generation rail defaults (speed + text/audio processing) ---------------


def _load_json(raw: Any) -> dict:
    import json

    if not raw:
        return {}
    try:
        value = json.loads(raw)
        return value if isinstance(value, dict) else {}
    except (TypeError, ValueError):
        return {}


def generation_settings_to_response(row: DBGenerationSettings):
    """Build the API response, decoding the JSON option columns."""
    from .. import models

    return models.GenerationSettingsResponse(
        max_chunk_chars=row.max_chunk_chars,
        crossfade_ms=row.crossfade_ms,
        normalize_audio=row.normalize_audio,
        autoplay_on_generate=row.autoplay_on_generate,
        speed=row.speed if row.speed is not None else 1.0,
        preprocessing=models.PreprocessingOptions.model_validate(_load_json(row.preprocessing_json)),
        postprocessing=_postprocessing_from_row(row),
    )


def _postprocessing_from_row(row: DBGenerationSettings):
    from .. import models

    if row.postprocessing_json:
        return models.PostprocessingOptions.model_validate(_load_json(row.postprocessing_json))
    # Never saved from the rail yet: honour the legacy normalize toggle.
    options = models.PostprocessingOptions()
    if not row.normalize_audio:
        options = options.model_copy(update={"loudness": "off"})
    return options


def update_generation_settings_from_request(db: Session, update) -> DBGenerationSettings:
    """Apply a ``GenerationSettingsUpdate``, encoding nested options as JSON."""
    import json

    patch = update.model_dump(exclude_unset=True, by_alias=True)
    preprocessing = patch.pop("preprocessing", None)
    postprocessing = patch.pop("postprocessing", None)
    if preprocessing is not None:
        patch["preprocessing_json"] = json.dumps(preprocessing)
    if postprocessing is not None:
        patch["postprocessing_json"] = json.dumps(postprocessing)
        # Keep the legacy flag in sync for older clients.
        patch["normalize_audio"] = postprocessing.get("loudness", "off") != "off"
    elif "normalize_audio" in patch:
        # Legacy toggle (Settings → Generation) drives the loudness mode.
        row = get_generation_settings(db)
        if row.postprocessing_json:
            current = _postprocessing_from_row(row).model_dump()
            wants = bool(patch["normalize_audio"])
            if wants != (current["loudness"] != "off"):
                current["loudness"] = "broadcast" if wants else "off"
                patch["postprocessing_json"] = json.dumps(current)
    return update_generation_settings(db, patch)


def resolve_generation_options(request, db: Session):
    """Fill speed / preprocessing / postprocessing on a request from the
    saved defaults when the caller omitted them.

    Returns ``(speed, preprocessing, postprocessing)``. The legacy
    ``normalize=False`` flag disables loudness when no explicit
    postprocessing was sent.
    """
    defaults = generation_settings_to_response(get_generation_settings(db))

    speed = request.speed if getattr(request, "speed", None) is not None else defaults.speed
    preprocessing = getattr(request, "preprocessing", None) or defaults.preprocessing
    postprocessing = getattr(request, "postprocessing", None)
    if postprocessing is None:
        postprocessing = defaults.postprocessing
        if getattr(request, "normalize", True) is False:
            postprocessing = postprocessing.model_copy(update={"loudness": "off"})
    return speed, preprocessing, postprocessing
