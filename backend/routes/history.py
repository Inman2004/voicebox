"""Generation history endpoints."""

import io

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy.orm import Session

from .. import config, models
from ..services import export_import, history
from ..app import safe_content_disposition
from ..database import Generation as DBGeneration, VoiceProfile as DBVoiceProfile, get_db

router = APIRouter()


def _history_query(
    profile_id: str | None = None,
    search: str | None = None,
    engine: str | None = None,
    language: str | None = None,
    status: str | None = None,
    favorites_only: bool = False,
    sort_by: str = "created_at",
    order: str = "desc",
    group_by: str = "none",
    limit: int = 50,
    offset: int = 0,
) -> models.HistoryQuery:
    from pydantic import ValidationError

    try:
        return models.HistoryQuery(
            profile_id=profile_id,
            search=search,
            engine=engine,
            language=language,
            status=status,
            favorites_only=favorites_only,
            sort_by=sort_by,
            order=order,
            group_by=group_by,
            limit=limit,
            offset=offset,
        )
    except ValidationError as e:
        raise HTTPException(status_code=422, detail=e.errors()) from e


@router.get("/history", response_model=models.HistoryListResponse)
async def list_history(
    query: models.HistoryQuery = Depends(_history_query),
    db: Session = Depends(get_db),
):
    """List generation history with filters, sorting and group ordering."""
    return await history.list_generations(query, db)


@router.get("/history/facets", response_model=models.HistoryFacetsResponse)
async def get_history_facets(
    query: models.HistoryQuery = Depends(_history_query),
    db: Session = Depends(get_db),
):
    """Filter counts and totals for the Gallery."""
    return await history.get_history_facets(query, db)


@router.post("/history/bulk", response_model=models.HistoryBulkResponse)
async def bulk_history_action(data: models.HistoryBulkRequest, db: Session = Depends(get_db)):
    """Favourite, unfavourite or delete many generations at once."""
    ids = list(dict.fromkeys(data.ids))
    if data.action == "delete":
        affected = 0
        for generation_id in ids:
            if await history.delete_generation(generation_id, db):
                affected += 1
        return models.HistoryBulkResponse(affected=affected)

    rows = db.query(DBGeneration).filter(DBGeneration.id.in_(ids)).all()
    for row in rows:
        row.is_favorited = data.action == "favorite"
    db.commit()
    return models.HistoryBulkResponse(affected=len(rows))


@router.post("/history/export-zip")
async def export_history_zip(data: models.HistoryExportZipRequest, db: Session = Depends(get_db)):
    """Download the active audio of several generations as one ZIP."""
    import zipfile

    rows = db.query(DBGeneration).filter(DBGeneration.id.in_(list(dict.fromkeys(data.ids)))).all()
    buffer = io.BytesIO()
    written = 0
    used_names: set[str] = set()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_STORED) as zf:  # WAV doesn't compress well
        for gen in sorted(rows, key=lambda g: g.created_at or 0):
            audio_path = config.resolve_storage_path(gen.audio_path) if gen.audio_path else None
            if audio_path is None or not audio_path.is_file():
                continue
            safe_text = "".join(c for c in gen.text[:30] if c.isalnum() or c in (" ", "-", "_")).strip() or "generation"
            name = f"{safe_text}-{gen.id[:8]}{audio_path.suffix or '.wav'}"
            if name in used_names:
                name = f"{safe_text}-{gen.id}{audio_path.suffix or '.wav'}"
            used_names.add(name)
            zf.write(audio_path, arcname=name)
            written += 1
    if written == 0:
        raise HTTPException(status_code=404, detail="None of the selected generations have audio")

    buffer.seek(0)
    return StreamingResponse(
        buffer,
        media_type="application/zip",
        headers={"Content-Disposition": safe_content_disposition("attachment", f"voicebox-{written}-clips.zip")},
    )


@router.get("/history/stats")
async def get_stats(db: Session = Depends(get_db)):
    """Get generation statistics."""
    return await history.get_generation_stats(db)


@router.post("/history/import")
async def import_generation(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    """Import a generation from a ZIP archive."""
    MAX_FILE_SIZE = 50 * 1024 * 1024

    content = await file.read()

    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=400, detail=f"File too large. Maximum size is {MAX_FILE_SIZE / (1024 * 1024)}MB"
        )

    try:
        result = await export_import.import_generation_from_zip(content, db)
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/history/failed")
async def clear_failed_generations(db: Session = Depends(get_db)):
    """Delete every generation with status='failed'. Used by the UI's 'Clear failed' button (#410)."""
    count = await history.delete_failed_generations(db)
    return {"deleted": count}


@router.get("/history/{generation_id}", response_model=models.HistoryResponse)
async def get_generation(
    generation_id: str,
    db: Session = Depends(get_db),
):
    """Get a generation by ID."""
    result = (
        db.query(DBGeneration, DBVoiceProfile.name.label("profile_name"))
        .join(DBVoiceProfile, DBGeneration.profile_id == DBVoiceProfile.id)
        .filter(DBGeneration.id == generation_id)
        .first()
    )

    if not result:
        raise HTTPException(status_code=404, detail="Generation not found")

    gen, profile_name = result
    return models.HistoryResponse(
        id=gen.id,
        profile_id=gen.profile_id,
        profile_name=profile_name,
        text=gen.text,
        language=gen.language,
        audio_path=gen.audio_path,
        duration=gen.duration,
        seed=gen.seed,
        instruct=gen.instruct,
        engine=gen.engine or "qwen",
        model_size=gen.model_size,
        status=gen.status or "completed",
        error=gen.error,
        is_favorited=bool(gen.is_favorited),
        started_at=gen.started_at,
        completed_at=gen.completed_at,
        load_seconds=gen.load_seconds,
        generation_seconds=gen.generation_seconds,
        created_at=gen.created_at,
    )


@router.post("/history/{generation_id}/favorite")
async def toggle_favorite(
    generation_id: str,
    db: Session = Depends(get_db),
):
    """Toggle the favorite status of a generation."""
    gen = db.query(DBGeneration).filter_by(id=generation_id).first()
    if not gen:
        raise HTTPException(status_code=404, detail="Generation not found")
    gen.is_favorited = not gen.is_favorited
    db.commit()
    return {"is_favorited": gen.is_favorited}


@router.delete("/history/{generation_id}")
async def delete_generation(
    generation_id: str,
    db: Session = Depends(get_db),
):
    """Delete a generation."""
    success = await history.delete_generation(generation_id, db)
    if not success:
        raise HTTPException(status_code=404, detail="Generation not found")
    return {"message": "Generation deleted successfully"}


@router.get("/history/{generation_id}/export")
async def export_generation(
    generation_id: str,
    db: Session = Depends(get_db),
):
    """Export a generation as a ZIP archive."""
    generation = db.query(DBGeneration).filter_by(id=generation_id).first()
    if not generation:
        raise HTTPException(status_code=404, detail="Generation not found")

    try:
        zip_bytes = export_import.export_generation_to_zip(generation_id, db)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    safe_text = "".join(c for c in generation.text[:30] if c.isalnum() or c in (" ", "-", "_")).strip()
    if not safe_text:
        safe_text = "generation"
    # Append a short id so exports of similarly-worded generations don't collide
    # on the same filename (the first 30 chars are frequently identical).
    filename = f"generation-{safe_text}-{generation_id[:8]}.voicebox.zip"

    return StreamingResponse(
        io.BytesIO(zip_bytes),
        media_type="application/zip",
        headers={"Content-Disposition": safe_content_disposition("attachment", filename)},
    )


@router.get("/history/{generation_id}/export-audio")
async def export_generation_audio(
    generation_id: str,
    db: Session = Depends(get_db),
):
    """Export only the audio file from a generation."""
    generation = db.query(DBGeneration).filter_by(id=generation_id).first()
    if not generation:
        raise HTTPException(status_code=404, detail="Generation not found")

    if not generation.audio_path:
        raise HTTPException(status_code=404, detail="Generation has no audio file")

    audio_path = config.resolve_storage_path(generation.audio_path)
    if audio_path is None or not audio_path.is_file():
        raise HTTPException(status_code=404, detail="Audio file not found")

    safe_text = "".join(c for c in generation.text[:30] if c.isalnum() or c in (" ", "-", "_")).strip()
    if not safe_text:
        safe_text = "generation"
    # Append a short id so exports of similarly-worded generations don't collide
    # on the same filename (the first 30 chars are frequently identical).
    filename = f"{safe_text}-{generation_id[:8]}.wav"

    return FileResponse(
        audio_path,
        media_type="audio/wav",
        headers={"Content-Disposition": safe_content_disposition("attachment", filename)},
    )
