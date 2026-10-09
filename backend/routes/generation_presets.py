"""Generation presets — named snapshots of speed + text/audio processing."""

import json
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models
from ..database import GenerationPreset as DBGenerationPreset, get_db

router = APIRouter(prefix="/generation-presets", tags=["generation-presets"])


def _to_response(row: DBGenerationPreset) -> models.GenerationPresetResponse:
    try:
        raw = json.loads(row.settings or "{}")
    except ValueError:
        raw = {}
    return models.GenerationPresetResponse(
        id=row.id,
        name=row.name,
        settings=models.GenerationPresetSettings.model_validate(raw),
        is_builtin=bool(row.is_builtin),
        created_at=row.created_at,
    )


def _dump(settings: models.GenerationPresetSettings) -> str:
    return json.dumps(settings.model_dump(by_alias=True))


@router.get("", response_model=list[models.GenerationPresetResponse])
async def list_generation_presets(db: Session = Depends(get_db)):
    rows = (
        db.query(DBGenerationPreset)
        .order_by(DBGenerationPreset.is_builtin.desc(), DBGenerationPreset.sort_order, DBGenerationPreset.name)
        .all()
    )
    return [_to_response(r) for r in rows]


@router.post("", response_model=models.GenerationPresetResponse)
async def create_generation_preset(data: models.GenerationPresetCreate, db: Session = Depends(get_db)):
    if db.query(DBGenerationPreset).filter_by(name=data.name).first():
        raise HTTPException(status_code=409, detail=f"A preset named '{data.name}' already exists")
    row = DBGenerationPreset(id=str(uuid.uuid4()), name=data.name, settings=_dump(data.settings), is_builtin=False)
    db.add(row)
    db.commit()
    db.refresh(row)
    return _to_response(row)


@router.put("/{preset_id}", response_model=models.GenerationPresetResponse)
async def update_generation_preset(
    preset_id: str, data: models.GenerationPresetUpdate, db: Session = Depends(get_db)
):
    row = db.query(DBGenerationPreset).filter_by(id=preset_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Preset not found")
    if row.is_builtin:
        raise HTTPException(status_code=400, detail="Built-in presets can't be modified")
    if data.name is not None and data.name != row.name:
        if db.query(DBGenerationPreset).filter_by(name=data.name).first():
            raise HTTPException(status_code=409, detail=f"A preset named '{data.name}' already exists")
        row.name = data.name
    if data.settings is not None:
        row.settings = _dump(data.settings)
    db.commit()
    db.refresh(row)
    return _to_response(row)


@router.delete("/{preset_id}")
async def delete_generation_preset(preset_id: str, db: Session = Depends(get_db)):
    row = db.query(DBGenerationPreset).filter_by(id=preset_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Preset not found")
    if row.is_builtin:
        raise HTTPException(status_code=400, detail="Built-in presets can't be deleted")
    db.delete(row)
    db.commit()
    return {"message": "Preset deleted"}
