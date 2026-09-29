"""Engine registry endpoint — the single source of engine metadata for the UI.

Download/loaded state is deliberately not included: the frontend already
polls ``/models/status`` and joins it by ``model_name``.
"""

from dataclasses import asdict

from fastapi import APIRouter

from .. import models

router = APIRouter()


@router.get("/engines", response_model=models.EngineListResponse)
async def list_engines():
    from ..backends import TTS_ENGINE_INFO, get_tts_model_configs

    configs = get_tts_model_configs()
    engines = []
    for engine, info in TTS_ENGINE_INFO.items():
        variants = [c for c in configs if c.engine == engine]
        if not variants:
            continue
        languages: list[str] = []
        for c in variants:
            for lang in c.languages:
                if lang not in languages:
                    languages.append(lang)
        engines.append(
            models.EngineResponse(
                engine=engine,
                display_name=info.display_name,
                tagline=info.tagline,
                description=info.description,
                icon=info.icon,
                color=info.color,
                languages=languages,
                supports_cloning=info.supports_cloning,
                supports_presets=info.supports_presets,
                supports_instruct=info.supports_instruct,
                supports_tags=info.supports_tags,
                native_speed=info.native_speed,
                speed_rating=info.speed_rating,
                quality_rating=info.quality_rating,
                parameters=[models.EngineParameterResponse(**asdict(p)) for p in info.parameters],
                variants=[
                    models.EngineVariantResponse(
                        model_name=c.model_name,
                        display_name=c.display_name,
                        model_size=c.model_size,
                        size_mb=c.size_mb,
                        languages=list(c.languages),
                    )
                    for c in variants
                ],
            )
        )
    return models.EngineListResponse(engines=engines)
