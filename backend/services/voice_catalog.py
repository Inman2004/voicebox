"""
Voice Library catalog for built-in engine voices.

The engine backends (``KOKORO_VOICES``, ``QWEN_CUSTOM_VOICES``) stay the
source of truth for which voice ids exist; this module layers UI metadata on
top — accent/locale, apparent age, style tags and a bundled avatar.
"""

from __future__ import annotations

import json
import logging
import sys
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class CatalogVoice:
    engine: str
    voice_id: str
    name: str
    gender: str
    language: str
    locale: str
    accent: str
    age: str = "middle_aged"  # young | middle_aged | senior
    styles: tuple[str, ...] = field(default_factory=tuple)
    description: Optional[str] = None
    avatar: Optional[str] = None  # filename under the avatars dir

    @property
    def key(self) -> str:
        return f"preset:{self.engine}:{self.voice_id}"


# Kokoro voice-id prefix → (locale, accent label)
_KOKORO_LOCALES = {
    "a": ("en-US", "American English"),
    "b": ("en-GB", "British English"),
    "e": ("es-ES", "Spanish"),
    "f": ("fr-FR", "French"),
    "h": ("hi-IN", "Hindi"),
    "i": ("it-IT", "Italian"),
    "j": ("ja-JP", "Japanese"),
    "p": ("pt-BR", "Brazilian Portuguese"),
    "z": ("zh-CN", "Mandarin Chinese"),
}

# Curated per-voice traits: (age, styles)
_KOKORO_TRAITS: dict[str, tuple[str, tuple[str, ...]]] = {
    "af_alloy": ("middle_aged", ("Professional", "Clear")),
    "af_aoede": ("middle_aged", ("Professional", "Smooth")),
    "af_bella": ("young", ("Storyteller", "Warm")),
    "af_heart": ("young", ("Storyteller", "Warm")),
    "af_jessica": ("middle_aged", ("Conversational",)),
    "af_kore": ("middle_aged", ("Professional", "Calm")),
    "af_nicole": ("young", ("Soft", "ASMR")),
    "af_nova": ("young", ("Energetic", "Conversational")),
    "af_river": ("middle_aged", ("Calm", "Narration")),
    "af_sarah": ("middle_aged", ("Professional", "Narration")),
    "af_sky": ("young", ("Bright", "Conversational")),
    "am_adam": ("middle_aged", ("Storyteller", "Deep")),
    "am_echo": ("middle_aged", ("Conversational",)),
    "am_eric": ("middle_aged", ("Storyteller", "Confident")),
    "am_fenrir": ("young", ("Professional", "Energetic")),
    "am_liam": ("young", ("Conversational", "Friendly")),
    "am_michael": ("middle_aged", ("Narration", "Warm")),
    "am_onyx": ("middle_aged", ("Deep", "Narration")),
    "am_puck": ("young", ("Playful", "Energetic")),
    "am_santa": ("senior", ("Jolly", "Character")),
    "bf_alice": ("middle_aged", ("Professional",)),
    "bf_emma": ("middle_aged", ("Professional", "Narration")),
    "bf_isabella": ("young", ("Warm", "Conversational")),
    "bf_lily": ("young", ("Soft", "Storyteller")),
    "bm_daniel": ("middle_aged", ("Professional", "Calm")),
    "bm_fable": ("young", ("Storyteller",)),
    "bm_george": ("middle_aged", ("Storyteller", "Deep")),
    "bm_lewis": ("middle_aged", ("Narration", "Deep")),
    "ef_dora": ("middle_aged", ("Conversational",)),
    "em_alex": ("middle_aged", ("Conversational",)),
    "em_santa": ("senior", ("Jolly", "Character")),
    "ff_siwis": ("young", ("Narration", "Soft")),
    "hf_alpha": ("young", ("Conversational",)),
    "hf_beta": ("middle_aged", ("Narration",)),
    "hm_omega": ("middle_aged", ("Narration",)),
    "hm_psi": ("young", ("Conversational",)),
    "if_sara": ("young", ("Conversational",)),
    "im_nicola": ("middle_aged", ("Narration",)),
    "jf_alpha": ("young", ("Conversational",)),
    "jf_gongitsune": ("young", ("Storyteller",)),
    "jf_nezumi": ("young", ("Soft", "Storyteller")),
    "jf_tebukuro": ("young", ("Storyteller", "Bright")),
    "jm_kumo": ("middle_aged", ("Narration", "Calm")),
    "pf_dora": ("middle_aged", ("Conversational",)),
    "pm_alex": ("middle_aged", ("Conversational",)),
    "pm_santa": ("senior", ("Jolly", "Character")),
    "zf_xiaobei": ("young", ("Conversational",)),
    "zf_xiaoni": ("young", ("Soft",)),
    "zf_xiaoxiao": ("young", ("Bright", "Narration")),
    "zf_xiaoyi": ("young", ("Conversational",)),
    "zm_yunjian": ("middle_aged", ("Narration", "Deep")),
    "zm_yunxi": ("young", ("Conversational",)),
    "zm_yunxia": ("young", ("Energetic",)),
    "zm_yunyang": ("middle_aged", ("Professional", "Narration")),
}

_QWEN_TRAITS: dict[str, tuple[str, str, str, tuple[str, ...]]] = {
    # voice_id: (locale, accent, age, styles)
    "Vivian": ("zh-CN", "Mandarin Chinese", "young", ("Bright", "Edgy")),
    "Serena": ("zh-CN", "Mandarin Chinese", "young", ("Warm", "Gentle")),
    "Uncle_Fu": ("zh-CN", "Mandarin Chinese", "senior", ("Deep", "Mellow")),
    "Dylan": ("zh-CN", "Beijing Mandarin", "young", ("Clear", "Natural")),
    "Eric": ("zh-CN", "Sichuan Mandarin", "middle_aged", ("Lively", "Husky")),
    "Ryan": ("en-US", "American English", "middle_aged", ("Energetic", "Rhythmic")),
    "Aiden": ("en-US", "American English", "young", ("Sunny", "Clear")),
    "Ono_Anna": ("ja-JP", "Japanese", "young", ("Playful", "Light")),
    "Sohee": ("ko-KR", "Korean", "young", ("Warm", "Emotive")),
}


def avatars_dir() -> Path:
    """Location of bundled avatar images (works from source and PyInstaller)."""
    base = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent.parent.parent))
    candidates = [base / "backend" / "voices" / "avatars", Path(__file__).resolve().parent.parent / "voices" / "avatars"]
    for c in candidates:
        if c.exists():
            return c
    return candidates[-1]


def samples_dir() -> Path:
    """Bundled preview clips (see scripts/build_voice_samples.py)."""
    return avatars_dir().parent / "samples"


@lru_cache(maxsize=1)
def _sample_manifest() -> dict[str, str]:
    path = samples_dir() / "manifest.json"
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        logger.warning("Could not read sample manifest: %s", e)
        return {}


def bundled_sample(engine: str, voice_id: str) -> Optional[Path]:
    """Path of the shipped preview clip for a built-in voice, if present."""
    name = _sample_manifest().get(f"{engine}:{voice_id}")
    if not name:
        return None
    path = samples_dir() / name
    return path if path.is_file() else None


@lru_cache(maxsize=1)
def _avatar_manifest() -> dict[str, str]:
    path = avatars_dir() / "manifest.json"
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        logger.warning("Could not read avatar manifest: %s", e)
        return {}


@lru_cache(maxsize=1)
def _build_catalog() -> dict[str, list[CatalogVoice]]:
    from ..backends.kokoro_backend import KOKORO_VOICES
    from ..backends.qwen_custom_voice_backend import QWEN_CUSTOM_VOICES

    manifest = _avatar_manifest()
    catalog: dict[str, list[CatalogVoice]] = {"kokoro": [], "qwen_custom_voice": []}

    for voice_id, name, gender, lang in KOKORO_VOICES:
        locale, accent = _KOKORO_LOCALES.get(voice_id[0], (lang, lang))
        age, styles = _KOKORO_TRAITS.get(voice_id, ("middle_aged", ()))
        catalog["kokoro"].append(
            CatalogVoice(
                engine="kokoro",
                voice_id=voice_id,
                name=name,
                gender=gender,
                language=lang,
                locale=locale,
                accent=accent,
                age=age,
                styles=styles,
                avatar=manifest.get(f"kokoro:{voice_id}"),
            )
        )

    for voice_id, name, gender, lang, desc in QWEN_CUSTOM_VOICES:
        locale, accent, age, styles = _QWEN_TRAITS.get(voice_id, (lang, lang, "middle_aged", ()))
        catalog["qwen_custom_voice"].append(
            CatalogVoice(
                engine="qwen_custom_voice",
                voice_id=voice_id,
                name=name,
                gender=gender,
                language=lang,
                locale=locale,
                accent=accent,
                age=age,
                styles=styles,
                description=desc,
                avatar=manifest.get(f"qwen_custom_voice:{voice_id}"),
            )
        )

    return catalog


def list_catalog_voices(engine: Optional[str] = None) -> list[CatalogVoice]:
    catalog = _build_catalog()
    if engine is None:
        return [v for voices in catalog.values() for v in voices]
    return list(catalog.get(engine, []))


def get_catalog_voice(engine: str, voice_id: str) -> Optional[CatalogVoice]:
    for v in _build_catalog().get(engine, []):
        if v.voice_id == voice_id:
            return v
    return None
