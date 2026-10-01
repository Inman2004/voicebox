"""Engine creation, initialization, and session management."""

import logging
import uuid

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from .. import config
from .models import (
    Base,
    AudioChannel,
    EffectPreset,
    Generation,
    GenerationPreset,
    GenerationVersion,
    ProfileChannelMapping,
    VoiceProfile,
)
from .migrations import run_migrations
from .seed import backfill_generation_versions, seed_builtin_generation_presets, seed_builtin_presets

logger = logging.getLogger(__name__)

# Initialized by init_db()
engine = None
SessionLocal = None
_db_path = None


def init_db() -> None:
    """Initialize the database engine, run migrations, create tables, and seed data."""
    global engine, SessionLocal, _db_path

    _db_path = config.get_db_path()
    _db_path.parent.mkdir(parents=True, exist_ok=True)

    engine = create_engine(
        f"sqlite:///{_db_path}",
        connect_args={"check_same_thread": False},
    )

    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    run_migrations(engine)
    Base.metadata.create_all(bind=engine)

    # Create default audio channel if it doesn't exist
    db = SessionLocal()
    try:
        default_channel = db.query(AudioChannel).filter(AudioChannel.is_default == True).first()
        if not default_channel:
            default_channel = AudioChannel(
                id=str(uuid.uuid4()),
                name="Default",
                is_default=True,
            )
            db.add(default_channel)

            for profile in db.query(VoiceProfile).all():
                db.add(ProfileChannelMapping(
                    profile_id=profile.id,
                    channel_id=default_channel.id,
                ))
            db.commit()
    finally:
        db.close()

    backfill_generation_versions(SessionLocal, Generation, GenerationVersion)
    seed_builtin_presets(SessionLocal, EffectPreset)
    seed_builtin_generation_presets(SessionLocal, GenerationPreset)
    _backfill_file_sizes()
    _apply_output_dir()


def _backfill_file_sizes() -> None:
    """Record the audio file size for rows saved before sizes were tracked."""
    db = SessionLocal()
    try:
        rows = db.query(Generation).filter(Generation.file_size.is_(None), Generation.audio_path != "").all()
        for row in rows:
            path = config.resolve_storage_path(row.audio_path)
            try:
                row.file_size = path.stat().st_size if path is not None else None
            except OSError:
                continue
        if rows:
            db.commit()
    finally:
        db.close()


def _apply_output_dir() -> None:
    """Point new generated audio at the saved output folder, if any."""
    from .models import GenerationSettings

    db = SessionLocal()
    try:
        row = db.query(GenerationSettings).first()
        folder = row.output_dir if row else None
    finally:
        db.close()
    if not folder:
        return
    try:
        config.set_generations_dir(folder)
    except ValueError as e:
        # E.g. an unplugged drive: keep working from the default folder.
        logger.warning("Output folder unavailable, using the default: %s", e)


def get_db():
    """Yield a database session (FastAPI dependency)."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
