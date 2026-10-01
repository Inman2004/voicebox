"""
Generation history management module.
"""

from typing import List, Optional, Tuple
from datetime import datetime
import uuid
import shutil
from pathlib import Path
from sqlalchemy.orm import Session
from sqlalchemy import or_

from ..models import GenerationRequest, GenerationResponse, HistoryQuery, HistoryResponse, HistoryListResponse, GenerationVersionResponse, EffectConfig
from ..database import Generation as DBGeneration, GenerationVersion as DBGenerationVersion, VoiceProfile as DBVoiceProfile
from .. import config


def _get_versions_for_generation(generation_id: str, db: Session) -> tuple:
    """Get versions list and active version ID for a generation."""
    import json
    versions_rows = (
        db.query(DBGenerationVersion)
        .filter_by(generation_id=generation_id)
        .order_by(DBGenerationVersion.created_at)
        .all()
    )
    if not versions_rows:
        return None, None

    versions = []
    active_version_id = None
    for v in versions_rows:
        effects_chain = None
        if v.effects_chain:
            try:
                raw = json.loads(v.effects_chain)
                effects_chain = [EffectConfig(**e) for e in raw]
            except Exception:
                pass
        versions.append(GenerationVersionResponse(
            id=v.id,
            generation_id=v.generation_id,
            label=v.label,
            audio_path=v.audio_path,
            effects_chain=effects_chain,
            is_default=v.is_default,
            created_at=v.created_at,
        ))
        if v.is_default:
            active_version_id = v.id

    return versions, active_version_id


async def create_generation(
    profile_id: str,
    text: str,
    language: str,
    audio_path: str,
    duration: float,
    seed: Optional[int],
    db: Session,
    instruct: Optional[str] = None,
    generation_id: Optional[str] = None,
    status: str = "completed",
    engine: Optional[str] = "qwen",
    model_size: Optional[str] = None,
    source: str = "manual",
) -> GenerationResponse:
    """
    Create a new generation history entry.

    Args:
        profile_id: Profile ID used for generation
        text: Generated text
        language: Language code
        audio_path: Path where audio was saved
        duration: Audio duration in seconds
        seed: Random seed used (if any)
        db: Database session
        instruct: Natural language instruction used (if any)
        generation_id: Pre-assigned ID (for async generation flow)
        status: Generation status (generating, completed, failed)
        engine: TTS engine used (qwen, luxtts, chatterbox, chatterbox_turbo)
        model_size: Model size variant (1.7B, 0.6B) — only relevant for qwen
        source: Origin marker stored on the row. ``"manual"`` for regular
            /generate calls; ``"personality_speak"`` for rows created
            by the /profiles/{id}/speak endpoint. Enables filtering the
            history view for personality-driven output.

    Returns:
        Created generation entry
    """
    db_generation = DBGeneration(
        id=generation_id or str(uuid.uuid4()),
        profile_id=profile_id,
        text=text,
        language=language,
        audio_path=audio_path,
        duration=duration,
        seed=seed,
        instruct=instruct,
        engine=engine,
        model_size=model_size,
        status=status,
        source=source,
        file_size=audio_file_size(audio_path),
        created_at=datetime.utcnow(),
    )

    db.add(db_generation)
    db.commit()
    db.refresh(db_generation)

    return GenerationResponse.model_validate(db_generation)


def audio_file_size(audio_path: Optional[str]) -> Optional[int]:
    """Size in bytes of a stored audio file, or None if it is missing."""
    resolved = config.resolve_storage_path(audio_path) if audio_path else None
    try:
        return resolved.stat().st_size if resolved is not None else None
    except OSError:
        return None


async def update_generation_status(
    generation_id: str,
    status: str,
    db: Session,
    audio_path: Optional[str] = None,
    duration: Optional[float] = None,
    error: Optional[str] = None,
    **timing,
) -> Optional[GenerationResponse]:
    """Update the status of a generation (used by async generation flow).

    ``timing`` may carry ``started_at``, ``completed_at``, ``load_seconds``
    and ``generation_seconds``.
    """
    generation = db.query(DBGeneration).filter_by(id=generation_id).first()
    if not generation:
        return None

    for key in ("started_at", "completed_at", "load_seconds", "generation_seconds"):
        if timing.get(key) is not None:
            setattr(generation, key, timing[key])
    generation.status = status
    if audio_path is not None:
        generation.audio_path = audio_path
        generation.file_size = audio_file_size(audio_path)
    if duration is not None:
        generation.duration = duration
    if error is not None:
        generation.error = error

    db.commit()
    db.refresh(generation)
    return GenerationResponse.model_validate(generation)


async def get_generation(
    generation_id: str,
    db: Session,
) -> Optional[GenerationResponse]:
    """
    Get a generation by ID.
    
    Args:
        generation_id: Generation ID
        db: Database session
        
    Returns:
        Generation or None if not found
    """
    generation = db.query(DBGeneration).filter_by(id=generation_id).first()
    if not generation:
        return None
    
    return GenerationResponse.model_validate(generation)


IN_PROGRESS_STATUSES = ("loading_model", "generating")


def profile_avatar_url(profile: DBVoiceProfile) -> Optional[str]:
    """The profile's uploaded avatar, else its built-in voice's bundled one."""
    if profile.avatar_path:
        return f"/profiles/{profile.id}/avatar"
    if (profile.voice_type or "cloned") == "preset" and profile.preset_engine and profile.preset_voice_id:
        try:
            from .voice_catalog import get_catalog_voice

            entry = get_catalog_voice(profile.preset_engine, profile.preset_voice_id)
        except ImportError:  # engine backends unavailable (e.g. minimal test env)
            return None
        if entry and entry.avatar:
            return f"/voices/avatars/{entry.avatar}"
    return None


def _apply_history_filters(q, query: HistoryQuery):
    if query.profile_id:
        q = q.filter(DBGeneration.profile_id == query.profile_id)
    if query.search:
        pattern = f"%{query.search}%"
        q = q.filter(or_(DBGeneration.text.like(pattern), DBVoiceProfile.name.like(pattern)))
    if query.engine:
        q = q.filter(DBGeneration.engine == query.engine)
    if query.language:
        q = q.filter(DBGeneration.language == query.language)
    if query.status == "in_progress":
        q = q.filter(DBGeneration.status.in_(IN_PROGRESS_STATUSES))
    elif query.status == "completed":
        q = q.filter(or_(DBGeneration.status == "completed", DBGeneration.status.is_(None)))
    elif query.status == "failed":
        q = q.filter(DBGeneration.status == "failed")
    if query.favorites_only:
        q = q.filter(DBGeneration.is_favorited.is_(True))
    return q


# Length groups (seconds) for group_by="length"; mirrored in the Gallery's grouping.ts.
LENGTH_BUCKETS = (30, 120, 600)


def _history_ordering(query: HistoryQuery) -> list:
    from sqlalchemy import case, func

    sort_columns = {
        "created_at": DBGeneration.created_at,
        "duration": DBGeneration.duration,
        "generation_seconds": DBGeneration.generation_seconds,
        "profile_name": func.lower(DBVoiceProfile.name),
        "text_length": func.length(DBGeneration.text),
        "file_size": DBGeneration.file_size,
    }
    column = sort_columns[query.sort_by]
    primary = column.asc() if query.order == "asc" else column.desc()
    # Missing values (e.g. no timing on old rows) always sort last.
    ordering = [column.is_(None), primary]

    group_columns = {
        "profile": func.lower(DBVoiceProfile.name),
        "engine": DBGeneration.engine,
        "language": DBGeneration.language,
        "status": DBGeneration.status,
    }
    if query.group_by == "length":
        # Longest group first: 10 min+, 2–10 min, 30 s–2 min, under 30 s.
        short, medium, long_ = LENGTH_BUCKETS
        bucket = case(
            (DBGeneration.duration >= long_, 0),
            (DBGeneration.duration >= medium, 1),
            (DBGeneration.duration >= short, 2),
            else_=3,
        )
        ordering = [bucket.asc(), *ordering]
    elif query.group_by in group_columns:
        ordering = [group_columns[query.group_by].asc(), *ordering]
    elif query.group_by == "date" and query.sort_by != "created_at":
        # Day buckets are contiguous only when ordered by time first.
        ordering = [func.date(DBGeneration.created_at).desc(), *ordering]
    # Stable tiebreak so pagination never repeats or skips rows.
    return [*ordering, DBGeneration.id.asc()]


async def list_generations(
    query: HistoryQuery,
    db: Session,
) -> HistoryListResponse:
    """List generations with filters, sorting and optional grouping order."""
    q = db.query(DBGeneration, DBVoiceProfile).join(
        DBVoiceProfile, DBGeneration.profile_id == DBVoiceProfile.id
    )
    q = _apply_history_filters(q, query)

    total_count = q.count()
    results = q.order_by(*_history_ordering(query)).offset(query.offset).limit(query.limit).all()

    items = []
    for generation, profile in results:
        versions, active_version_id = _get_versions_for_generation(generation.id, db)
        items.append(HistoryResponse(
            id=generation.id,
            profile_id=generation.profile_id,
            profile_name=profile.name,
            profile_avatar_url=profile_avatar_url(profile),
            text=generation.text,
            language=generation.language,
            audio_path=generation.audio_path,
            duration=generation.duration,
            seed=generation.seed,
            instruct=generation.instruct,
            engine=generation.engine or "qwen",
            model_size=generation.model_size,
            status=generation.status or "completed",
            error=generation.error,
            is_favorited=bool(generation.is_favorited),
            started_at=generation.started_at,
            completed_at=generation.completed_at,
            load_seconds=generation.load_seconds,
            generation_seconds=generation.generation_seconds,
            diagnostics=generation.diagnostics,
            file_size=generation.file_size,
            created_at=generation.created_at,
            versions=versions,
            active_version_id=active_version_id,
        ))

    return HistoryListResponse(
        items=items,
        total=total_count,
    )


async def delete_generation(
    generation_id: str,
    db: Session,
) -> bool:
    """
    Delete a generation.
    
    Args:
        generation_id: Generation ID
        db: Database session
        
    Returns:
        True if deleted, False if not found
    """
    generation = db.query(DBGeneration).filter_by(id=generation_id).first()
    if not generation:
        return False

    # Delete all version files and records
    from . import versions as versions_mod
    versions_mod.delete_versions_for_generation(generation_id, db)

    # Delete main audio file (if not already removed by version cleanup)
    if generation.audio_path:
        audio_path = config.resolve_storage_path(generation.audio_path)
        if audio_path is not None and audio_path.exists():
            audio_path.unlink()

    # Delete from database
    db.delete(generation)
    db.commit()
    
    return True


async def delete_failed_generations(db: Session) -> int:
    """
    Delete every generation whose status is 'failed'.

    Used by the "Clear failed" action in the UI so users can tidy up
    history after the model wasn't loaded, the app was closed mid-run,
    or a generation otherwise errored out (see issue #410).

    Returns:
        Number of generations deleted.
    """
    from . import versions as versions_mod

    failed = db.query(DBGeneration).filter(DBGeneration.status == "failed").all()
    count = 0
    for generation in failed:
        # Clean up version files/rows first.
        versions_mod.delete_versions_for_generation(generation.id, db)

        # Remove the main audio file if it somehow made it to disk.
        if generation.audio_path:
            audio_path = config.resolve_storage_path(generation.audio_path)
            if audio_path is not None and audio_path.exists():
                try:
                    audio_path.unlink()
                except OSError:
                    # Best-effort cleanup — don't abort the whole sweep
                    # if a single file can't be removed.
                    pass

        db.delete(generation)
        count += 1

    db.commit()
    return count


async def delete_generations_by_profile(
    profile_id: str,
    db: Session,
) -> int:
    """
    Delete all generations for a profile.
    
    Args:
        profile_id: Profile ID
        db: Database session
        
    Returns:
        Number of generations deleted
    """
    generations = db.query(DBGeneration).filter_by(profile_id=profile_id).all()
    
    count = 0
    for generation in generations:
        # Delete associated version files and rows first
        from . import versions as versions_mod
        versions_mod.delete_versions_for_generation(generation.id, db)

        # Delete audio file
        audio_path = config.resolve_storage_path(generation.audio_path)
        if audio_path is not None and audio_path.exists():
            audio_path.unlink()
        
        # Delete from database
        db.delete(generation)
        count += 1
    
    db.commit()
    
    return count


async def get_generation_stats(db: Session) -> dict:
    """
    Get generation statistics.
    
    Args:
        db: Database session
        
    Returns:
        Statistics dictionary
    """
    from sqlalchemy import func
    
    total = db.query(func.count(DBGeneration.id)).scalar()
    
    total_duration = db.query(func.sum(DBGeneration.duration)).scalar() or 0
    
    # Get generations by profile
    by_profile = db.query(
        DBGeneration.profile_id,
        func.count(DBGeneration.id).label('count')
    ).group_by(DBGeneration.profile_id).all()
    
    return {
        "total_generations": total,
        "total_duration_seconds": total_duration,
        "generations_by_profile": {
            profile_id: count for profile_id, count in by_profile
        },
    }


async def get_history_facets(query: HistoryQuery, db: Session):
    """Counts per voice / engine / language / status for the Gallery filters.

    Each dimension is counted with every *other* active filter applied, so a
    selected engine still shows how many results the other engines have.
    Totals reflect all active filters.
    """
    from sqlalchemy import func

    from ..models import HistoryFacetsResponse, HistoryFacetValue

    def base(**drop):
        narrowed = query.model_copy(update=drop)
        return _apply_history_filters(
            db.query(DBGeneration).join(DBVoiceProfile, DBGeneration.profile_id == DBVoiceProfile.id),
            narrowed,
        )

    filtered = base()
    total = filtered.count()
    totals = filtered.with_entities(
        func.coalesce(func.sum(DBGeneration.duration), 0.0),
        func.coalesce(func.sum(DBGeneration.generation_seconds), 0.0),
    ).one()
    favorites = base(favorites_only=False).filter(DBGeneration.is_favorited.is_(True)).count()

    profile_rows = (
        base(profile_id=None)
        .with_entities(DBVoiceProfile, func.count(DBGeneration.id))
        .group_by(DBVoiceProfile.id)
        .order_by(func.lower(DBVoiceProfile.name))
        .all()
    )
    engine_rows = (
        base(engine=None)
        .with_entities(DBGeneration.engine, func.count(DBGeneration.id))
        .group_by(DBGeneration.engine)
        .all()
    )
    language_rows = (
        base(language=None)
        .with_entities(DBGeneration.language, func.count(DBGeneration.id))
        .group_by(DBGeneration.language)
        .all()
    )
    status_rows = (
        base(status=None)
        .with_entities(DBGeneration.status, func.count(DBGeneration.id))
        .group_by(DBGeneration.status)
        .all()
    )

    status_counts = {"completed": 0, "in_progress": 0, "failed": 0}
    for status, count in status_rows:
        key = "in_progress" if status in IN_PROGRESS_STATUSES else ("failed" if status == "failed" else "completed")
        status_counts[key] += count

    return HistoryFacetsResponse(
        total=total,
        total_duration_seconds=float(totals[0] or 0),
        total_generation_seconds=float(totals[1] or 0),
        favorites=favorites,
        profiles=[
            HistoryFacetValue(value=p.id, label=p.name, count=c, avatar_url=profile_avatar_url(p))
            for p, c in profile_rows
        ],
        engines=[
            HistoryFacetValue(value=e or "qwen", label=e or "qwen", count=c)
            for e, c in sorted(engine_rows, key=lambda r: -r[1])
        ],
        languages=[
            HistoryFacetValue(value=lang or "en", label=lang or "en", count=c)
            for lang, c in sorted(language_rows, key=lambda r: -r[1])
        ],
        statuses=[HistoryFacetValue(value=k, label=k, count=v) for k, v in status_counts.items() if v],
    )
