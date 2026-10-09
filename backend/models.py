"""
Pydantic models for request/response validation.
"""

from pydantic import BaseModel, Field
from typing import Optional, List, Literal
from datetime import datetime

from .utils.capture_chords import (
    default_push_to_talk_chord,
    default_toggle_to_talk_chord,
)

# Single source for engine validation across request schemas.
ENGINE_PATTERN = "^(qwen|qwen_custom_voice|luxtts|chatterbox|chatterbox_turbo|tada|kokoro)$"


class VoiceProfileCreate(BaseModel):
    """Request model for creating a voice profile."""

    name: str = Field(..., min_length=1, max_length=100)
    description: Optional[str] = Field(None, max_length=500)
    language: str = Field(
        default="en", pattern="^(zh|en|ja|ko|de|fr|ru|pt|es|it|he|ar|da|el|fi|hi|ms|nl|no|pl|sv|sw|tr)$"
    )
    voice_type: Optional[str] = Field(default="cloned", pattern="^(cloned|preset|designed)$")
    preset_engine: Optional[str] = Field(None, max_length=50)
    preset_voice_id: Optional[str] = Field(None, max_length=100)
    design_prompt: Optional[str] = Field(None, max_length=2000)
    default_engine: Optional[str] = Field(None, max_length=50)
    personality: Optional[str] = Field(None, max_length=2000)


class VoiceProfileResponse(BaseModel):
    """Response model for voice profile."""

    id: str
    name: str
    description: Optional[str]
    language: str
    avatar_path: Optional[str] = None
    effects_chain: Optional[List["EffectConfig"]] = None
    voice_type: str = "cloned"
    preset_engine: Optional[str] = None
    preset_voice_id: Optional[str] = None
    design_prompt: Optional[str] = None
    default_engine: Optional[str] = None
    personality: Optional[str] = None
    generation_count: int = 0
    sample_count: int = 0
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class ProfileSampleCreate(BaseModel):
    """Request model for adding a sample to a profile."""

    reference_text: str = Field(..., min_length=1, max_length=1000)


class ProfileSampleUpdate(BaseModel):
    """Request model for updating a profile sample."""

    reference_text: str = Field(..., min_length=1, max_length=1000)


class ProfileSampleResponse(BaseModel):
    """Response model for profile sample."""

    id: str
    profile_id: str
    audio_path: str
    reference_text: str

    class Config:
        from_attributes = True


class WordReplacement(BaseModel):
    """One "sound word" substitution applied before synthesis."""

    source: str = Field(..., min_length=1, max_length=200, alias="from")
    target: str = Field(default="", max_length=200, alias="to")

    model_config = {"populate_by_name": True}


class PreprocessingOptions(BaseModel):
    """Text clean-up applied before the text reaches the TTS engine."""

    normalize_whitespace: bool = True
    smart_numbers: bool = False
    lowercase: bool = False
    fix_initials: bool = True
    remove_reference_numbers: bool = True
    sentence_pause_ms: int = Field(default=0, ge=0, le=5000)
    replacements: List[WordReplacement] = Field(default_factory=list, max_length=500)


class PostprocessingOptions(BaseModel):
    """Audio clean-up applied after synthesis, before any effects chain."""

    remove_silence: bool = False
    loudness: str = Field(default="broadcast", pattern="^(off|simple|broadcast)$")
    # -16 LUFS is the common target for spoken-word content and roughly
    # matches the loudness of the previous RMS normalizer.
    target_lufs: float = Field(default=-16.0, ge=-40.0, le=-8.0)


class QwenExecutionOptions(BaseModel):
    mode: Literal["auto", "cuda_only", "cpu"] = "auto"
    precision: Literal["auto", "bf16", "fp16"] = "auto"
    efficient_attention: bool = False
    # CUDA-graph talker decoding (backends/qwen_fast_decode.py); falls back
    # to the standard decoder automatically when unsupported.
    fast_decode: bool = True


class GenerationRequest(BaseModel):
    """Request model for voice generation."""

    profile_id: str
    text: str = Field(..., min_length=1, max_length=50000)
    language: str = Field(default="en", pattern="^(zh|en|ja|ko|de|fr|ru|pt|es|it|he|ar|da|el|fi|hi|ms|nl|no|pl|sv|sw|tr)$")
    seed: Optional[int] = Field(None, ge=0)
    model_size: Optional[str] = Field(default="1.7B", pattern="^(1\\.7B|0\\.6B|1B|3B)$")
    instruct: Optional[str] = Field(None, max_length=500)
    engine: Optional[str] = Field(default="qwen", pattern=ENGINE_PATTERN)
    personality: bool = Field(
        default=False,
        description="When true and the profile has a personality prompt, the input text is rewritten in-character before TTS.",
    )
    max_chunk_chars: int = Field(
        default=800, ge=100, le=5000, description="Max characters per chunk for long text splitting"
    )
    crossfade_ms: int = Field(
        default=50, ge=0, le=500, description="Crossfade duration in ms between chunks (0 for hard cut)"
    )
    normalize: bool = Field(default=True, description="Normalize output audio volume")
    effects_chain: Optional[List["EffectConfig"]] = Field(
        None, description="Effects chain to apply after generation (overrides profile default)"
    )
    speed: Optional[float] = Field(
        None, ge=0.5, le=2.0, description="Speech rate multiplier. Omit to use the saved default."
    )
    preprocessing: Optional[PreprocessingOptions] = Field(
        None, description="Text preprocessing. Omit to use the saved defaults."
    )
    postprocessing: Optional[PostprocessingOptions] = Field(
        None,
        description="Audio post-processing. Omit to use the saved defaults (legacy `normalize` still honoured).",
    )
    qwen_execution: Optional[QwenExecutionOptions] = None


class GenerationResponse(BaseModel):
    """Response model for voice generation."""

    id: str
    profile_id: str
    text: str
    language: str
    audio_path: Optional[str] = None
    duration: Optional[float] = None
    seed: Optional[int] = None
    instruct: Optional[str] = None
    engine: Optional[str] = "qwen"
    model_size: Optional[str] = None
    status: str = "completed"
    error: Optional[str] = None
    is_favorited: bool = False
    source: str = "manual"
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    load_seconds: Optional[float] = None
    generation_seconds: Optional[float] = None
    diagnostics: Optional[dict] = None
    created_at: datetime
    versions: Optional[List["GenerationVersionResponse"]] = None
    active_version_id: Optional[str] = None

    class Config:
        from_attributes = True


HISTORY_SORT_PATTERN = "^(created_at|duration|generation_seconds|profile_name|text_length|file_size)$"
HISTORY_GROUP_PATTERN = "^(none|date|profile|engine|language|status|length)$"


class HistoryQuery(BaseModel):
    """Query model for generation history."""

    profile_id: Optional[str] = None
    search: Optional[str] = None
    engine: Optional[str] = None
    language: Optional[str] = None
    # "completed" | "failed" | "in_progress" (loading_model + generating)
    status: Optional[str] = Field(default=None, pattern="^(completed|failed|in_progress)$")
    favorites_only: bool = False
    sort_by: str = Field(default="created_at", pattern=HISTORY_SORT_PATTERN)
    order: str = Field(default="desc", pattern="^(asc|desc)$")
    # Rows are ordered by the group key first so groups arrive contiguous
    # across pages.
    group_by: str = Field(default="none", pattern=HISTORY_GROUP_PATTERN)
    limit: int = Field(default=50, ge=1, le=100)
    offset: int = Field(default=0, ge=0)


class HistoryFacetValue(BaseModel):
    value: str
    label: str
    count: int
    avatar_url: Optional[str] = None


class HistoryFacetsResponse(BaseModel):
    total: int
    total_duration_seconds: float
    total_generation_seconds: float
    favorites: int
    profiles: List[HistoryFacetValue]
    engines: List[HistoryFacetValue]
    languages: List[HistoryFacetValue]
    statuses: List[HistoryFacetValue]


class HistoryBulkRequest(BaseModel):
    ids: List[str] = Field(..., min_length=1, max_length=1000)
    action: str = Field(..., pattern="^(delete|favorite|unfavorite)$")


class HistoryBulkResponse(BaseModel):
    affected: int


class HistoryExportZipRequest(BaseModel):
    format: Literal["wav", "mp3", "m4a"] = "wav"
    ids: List[str] = Field(..., min_length=1, max_length=1000)


class HistoryResponse(BaseModel):
    diagnostics: Optional[dict] = None
    file_size: Optional[int] = None
    """Response model for history entry (includes profile name)."""

    id: str
    profile_id: str
    profile_name: str
    profile_avatar_url: Optional[str] = None
    text: str
    language: str
    audio_path: Optional[str] = None
    duration: Optional[float] = None
    seed: Optional[int] = None
    instruct: Optional[str] = None
    engine: Optional[str] = "qwen"
    model_size: Optional[str] = None
    status: str = "completed"
    error: Optional[str] = None
    is_favorited: bool = False
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    load_seconds: Optional[float] = None
    generation_seconds: Optional[float] = None
    created_at: datetime
    versions: Optional[List["GenerationVersionResponse"]] = None
    active_version_id: Optional[str] = None

    class Config:
        from_attributes = True


class HistoryListResponse(BaseModel):
    """Response model for history list."""

    items: List[HistoryResponse]
    total: int


class TranscriptionRequest(BaseModel):
    """Request model for audio transcription."""

    language: Optional[str] = Field(None, pattern="^(en|zh|ja|ko|de|fr|ru|pt|es|it)$")
    model: Optional[str] = Field(None, pattern="^(base|small|medium|large|turbo)$")


class TranscriptionResponse(BaseModel):
    """Response model for transcription."""

    text: str
    duration: float


class RefinementFlagsModel(BaseModel):
    """Boolean toggles that drive the refinement prompt builder."""

    smart_cleanup: bool = True
    self_correction: bool = True
    preserve_technical: bool = True


class CaptureResponse(BaseModel):
    """Response model for a capture."""

    id: str
    audio_path: str
    source: str
    language: Optional[str] = None
    duration_ms: Optional[int] = None
    transcript_raw: str
    transcript_refined: Optional[str] = None
    stt_model: Optional[str] = None
    llm_model: Optional[str] = None
    refinement_flags: Optional[RefinementFlagsModel] = None
    created_at: datetime

    class Config:
        from_attributes = True


class CaptureListResponse(BaseModel):
    """Response model for paginated capture list."""

    items: List[CaptureResponse]
    total: int


class CaptureCreateResponse(CaptureResponse):
    """
    Response model for ``POST /captures``.

    Adds ``auto_refine`` and ``allow_auto_paste`` — the server-side settings
    captured at the moment the capture was created. The client reads these to
    decide whether to chain a refinement request and whether to fire the
    synthetic-paste pipeline, so it doesn't need a synced local copy of the
    capture_settings table across sibling Tauri webviews.
    """

    auto_refine: bool
    allow_auto_paste: bool


class CaptureRefineRequest(BaseModel):
    """Request to refine a capture's transcript via the LLM."""

    flags: Optional[RefinementFlagsModel] = None
    model_size: Optional[str] = Field(default=None, pattern="^(0\\.6B|1\\.7B|4B)$")


class CaptureRetranscribeRequest(BaseModel):
    """Request to re-run STT on a capture's audio with a different model."""

    model: Optional[str] = Field(None, pattern="^(base|small|medium|large|turbo)$")
    language: Optional[str] = Field(None, pattern="^(en|zh|ja|ko|de|fr|ru|pt|es|it)$")


class CaptureSettingsResponse(BaseModel):
    """Server-persisted defaults for the capture / refine flow."""

    stt_model: str = Field(default="turbo", pattern="^(base|small|medium|large|turbo)$")
    language: str = Field(default="auto")
    auto_refine: bool = True
    llm_model: str = Field(default="0.6B", pattern="^(0\\.6B|1\\.7B|4B)$")
    smart_cleanup: bool = True
    self_correction: bool = True
    preserve_technical: bool = True
    allow_auto_paste: bool = True
    default_playback_voice_id: Optional[str] = None
    hotkey_enabled: bool = False
    chord_push_to_talk_keys: List[str] = Field(
        default_factory=default_push_to_talk_chord
    )
    chord_toggle_to_talk_keys: List[str] = Field(
        default_factory=default_toggle_to_talk_chord
    )

    class Config:
        from_attributes = True


class CaptureSettingsUpdate(BaseModel):
    """Partial update for capture settings — every field is optional."""

    stt_model: Optional[str] = Field(default=None, pattern="^(base|small|medium|large|turbo)$")
    language: Optional[str] = None
    auto_refine: Optional[bool] = None
    llm_model: Optional[str] = Field(default=None, pattern="^(0\\.6B|1\\.7B|4B)$")
    smart_cleanup: Optional[bool] = None
    self_correction: Optional[bool] = None
    preserve_technical: Optional[bool] = None
    allow_auto_paste: Optional[bool] = None
    default_playback_voice_id: Optional[str] = None
    hotkey_enabled: Optional[bool] = None
    chord_push_to_talk_keys: Optional[List[str]] = Field(default=None, min_length=1, max_length=6)
    chord_toggle_to_talk_keys: Optional[List[str]] = Field(default=None, min_length=1, max_length=6)


class GenerationSettingsResponse(BaseModel):
    """Server-persisted defaults for the generation flow."""

    max_chunk_chars: int = Field(default=800, ge=100, le=5000)
    crossfade_ms: int = Field(default=50, ge=0, le=500)
    normalize_audio: bool = True
    autoplay_on_generate: bool = True
    speed: float = Field(default=1.0, ge=0.5, le=2.0)
    preprocessing: PreprocessingOptions = Field(default_factory=PreprocessingOptions)
    postprocessing: PostprocessingOptions = Field(default_factory=PostprocessingOptions)
    qwen_execution: QwenExecutionOptions = Field(default_factory=QwenExecutionOptions)
    # Folder the user chose for generated audio (None = default location).
    output_dir: Optional[str] = None
    # Where new audio is actually being written right now.
    effective_output_dir: Optional[str] = None
    default_output_dir: Optional[str] = None

    class Config:
        from_attributes = True


class GenerationSettingsUpdate(BaseModel):
    """Partial update for generation settings — every field is optional."""

    max_chunk_chars: Optional[int] = Field(default=None, ge=100, le=5000)
    crossfade_ms: Optional[int] = Field(default=None, ge=0, le=500)
    normalize_audio: Optional[bool] = None
    autoplay_on_generate: Optional[bool] = None
    speed: Optional[float] = Field(default=None, ge=0.5, le=2.0)
    preprocessing: Optional[PreprocessingOptions] = None
    postprocessing: Optional[PostprocessingOptions] = None
    qwen_execution: Optional[QwenExecutionOptions] = None
    # Absolute folder for new generated audio; "" or null restores the default.
    output_dir: Optional[str] = Field(default=None, max_length=1024)


class GenerationPresetSettings(BaseModel):
    """The rail values a generation preset snapshots."""

    speed: float = Field(default=1.0, ge=0.5, le=2.0)
    preprocessing: PreprocessingOptions = Field(default_factory=PreprocessingOptions)
    postprocessing: PostprocessingOptions = Field(default_factory=PostprocessingOptions)


class GenerationPresetCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    settings: GenerationPresetSettings


class GenerationPresetUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    settings: Optional[GenerationPresetSettings] = None


class GenerationPresetResponse(BaseModel):
    id: str
    name: str
    settings: GenerationPresetSettings
    is_builtin: bool
    created_at: datetime


class EngineParameterResponse(BaseModel):
    key: str
    label: str
    min: float
    max: float
    step: float
    default: float
    unit: str = ""
    help: str = ""


class EngineVariantResponse(BaseModel):
    model_name: str
    display_name: str
    model_size: str
    size_mb: int
    languages: List[str]


class EngineResponse(BaseModel):
    engine: str
    display_name: str
    tagline: str
    description: str
    icon: str
    color: str
    languages: List[str]
    supports_cloning: bool
    supports_presets: bool
    supports_instruct: bool
    supports_tags: bool
    native_speed: bool
    speed_rating: int
    quality_rating: int
    parameters: List[EngineParameterResponse]
    variants: List[EngineVariantResponse]


class EngineListResponse(BaseModel):
    engines: List[EngineResponse]


class LibraryVoice(BaseModel):
    """A voice as shown in the Voice Library — either a built-in engine
    preset or one of the user's own profiles."""

    key: str  # "preset:<engine>:<voice_id>" or "profile:<id>"
    kind: str  # "preset" | "profile"
    name: str
    engine: Optional[str] = None
    voice_id: Optional[str] = None
    profile_id: Optional[str] = None
    voice_type: Optional[str] = None
    gender: Optional[str] = None
    language: str
    locale: Optional[str] = None
    accent: Optional[str] = None
    age: Optional[str] = None
    styles: List[str] = Field(default_factory=list)
    description: Optional[str] = None
    avatar_url: Optional[str] = None
    favorite: bool = False
    has_preview: bool = True


class LibraryVoiceListResponse(BaseModel):
    voices: List[LibraryVoice]


class ActivateVoiceRequest(BaseModel):
    engine: str = Field(..., pattern=ENGINE_PATTERN)
    voice_id: str = Field(..., min_length=1, max_length=100)


class ActivateVoiceResponse(BaseModel):
    profile_id: str
    created: bool


class SystemResourcesResponse(BaseModel):
    observed_at: Optional[str] = None
    inference: Optional[dict] = None
    cpu_percent: Optional[float] = None
    app_ram_mb: Optional[float] = None
    system_ram_used_mb: Optional[float] = None
    system_ram_total_mb: Optional[float] = None
    gpu_percent: Optional[float] = None
    gpu_name: Optional[str] = None
    vram_used_mb: Optional[float] = None
    vram_total_mb: Optional[float] = None
    loaded_models: List[str] = Field(default_factory=list)


class MCPClientBindingResponse(BaseModel):
    """Per-MCP-client voice binding — what voice / engine the server should
    use when a given client_id calls voicebox.speak without args, plus an
    opt-in personality-rewrite default."""

    client_id: str
    label: Optional[str] = None
    profile_id: Optional[str] = None
    default_engine: Optional[str] = Field(
        None,
        pattern=ENGINE_PATTERN,
    )
    default_personality: bool = False
    last_seen_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class MCPClientBindingUpsert(BaseModel):
    """Create or update a binding. Matched by ``client_id``."""

    client_id: str = Field(..., min_length=1, max_length=64)
    label: Optional[str] = Field(None, max_length=128)
    profile_id: Optional[str] = None
    default_engine: Optional[str] = Field(
        None,
        pattern=ENGINE_PATTERN,
    )
    default_personality: bool = False


class MCPClientBindingListResponse(BaseModel):
    items: List[MCPClientBindingResponse]


class SpeakRequest(BaseModel):
    """Body for POST /speak — non-MCP REST surface that mirrors voicebox.speak."""

    text: str = Field(..., min_length=1, max_length=10000)
    profile: Optional[str] = Field(
        None,
        description="Voice profile name or id. Falls back to per-client binding, then default.",
    )
    engine: Optional[str] = Field(
        None,
        pattern=ENGINE_PATTERN,
    )
    personality: Optional[bool] = Field(
        None,
        description="When true and the profile has a personality prompt, the input text is rewritten in-character before TTS. When null, the per-client binding's default_personality flag decides.",
    )
    language: Optional[str] = Field(
        None,
        pattern="^(zh|en|ja|ko|de|fr|ru|pt|es|it|he|ar|da|el|fi|hi|ms|nl|no|pl|sv|sw|tr)$",
    )


class LLMGenerateRequest(BaseModel):
    """Request model for LLM text generation."""

    prompt: str = Field(..., min_length=1, max_length=50000)
    system: Optional[str] = Field(None, max_length=4000)
    model_size: Optional[str] = Field(default="0.6B", pattern="^(0\\.6B|1\\.7B|4B)$")
    max_tokens: int = Field(default=512, ge=1, le=4096)
    temperature: float = Field(default=0.7, ge=0.0, le=2.0)
    # Few-shot (user, assistant) pairs prepended as real chat turns.
    # Used by the refinement service to pin tricky rules (imperatives
    # staying imperatives, technical-term punctuation) that small models
    # lose when the examples live inline in the system prompt.
    examples: Optional[List[List[str]]] = Field(default=None, max_length=8)


class LLMGenerateResponse(BaseModel):
    """Response model for LLM text generation."""

    text: str
    model_size: str


# ── Profile personality endpoint ──────────────────────────────────────
# The sole standalone personality endpoint is ``/profiles/{id}/compose``,
# which produces a fresh in-character utterance the UI drops into the
# generate textarea. Rewrite is now reached via ``/generate`` with
# ``personality=true``.


class PersonalityTextResponse(BaseModel):
    """Response returned by the ``/profiles/{id}/compose`` endpoint."""

    text: str
    model_size: str


class ModelReadiness(BaseModel):
    """Per-model entry in the dictation readiness checklist.

    ``model_name`` is the canonical id used by ``POST /models/download`` so the
    frontend can wire a one-click "Download" button without a second lookup.
    ``size`` is the user's chosen variant (e.g. "turbo", "0.6B"); ``display_name``
    is what the checklist row should show ("Whisper Turbo").
    """

    ready: bool
    model_name: str
    display_name: str
    size: str
    size_mb: Optional[int] = None


class CaptureReadinessResponse(BaseModel):
    """Backend gates that must be green before the global hotkey will fire.

    The frontend combines this with its own TCC permission checks (input
    monitoring, accessibility) into the full dictation readiness checklist.
    Hotkey-enabled is the user's intent toggle and lives outside this struct.
    """

    stt: ModelReadiness
    llm: ModelReadiness


class HealthResponse(BaseModel):
    """Response model for health check."""

    status: str
    model_loaded: bool
    model_downloaded: Optional[bool] = None  # Whether model is cached/downloaded
    model_size: Optional[str] = None  # Current model size if loaded
    gpu_available: bool
    gpu_type: Optional[str] = None  # GPU type (CUDA, MPS, or None)
    vram_used_mb: Optional[float] = None
    backend_type: Optional[str] = None  # Backend type (mlx or pytorch)
    backend_variant: Optional[str] = None  # Binary variant (cpu, cuda, or rocm)
    supports_rocm: bool = False  # AMD GPU on Windows — the ROCm backend is applicable
    gpu_compatibility_warning: Optional[str] = None  # Warning if GPU arch unsupported


class DirectoryCheck(BaseModel):
    """Health status for a single directory."""

    path: str
    exists: bool
    writable: bool
    error: Optional[str] = None


class FilesystemHealthResponse(BaseModel):
    """Response model for filesystem health check."""

    healthy: bool
    disk_free_mb: Optional[float] = None
    disk_total_mb: Optional[float] = None
    directories: List[DirectoryCheck]


class ModelStatus(BaseModel):
    """Response model for model status."""

    model_name: str
    display_name: str
    hf_repo_id: Optional[str] = None  # HuggingFace repository ID
    downloaded: bool
    downloading: bool = False  # True if download is in progress
    size_mb: Optional[float] = None
    loaded: bool = False


class ModelStatusListResponse(BaseModel):
    """Response model for model status list."""

    models: List[ModelStatus]


class ModelDownloadRequest(BaseModel):
    """Request model for triggering model download."""

    model_name: str


class ModelMigrateRequest(BaseModel):
    """Request model for migrating models to a new directory."""

    destination: str


class ActiveDownloadTask(BaseModel):
    """Response model for active download task."""

    model_name: str
    status: str
    started_at: datetime
    error: Optional[str] = None
    progress: Optional[float] = None  # 0-100 percentage
    current: Optional[int] = None  # bytes downloaded
    total: Optional[int] = None  # total bytes
    filename: Optional[str] = None  # current file being downloaded


class ActiveGenerationTask(BaseModel):
    """Response model for active generation task."""

    task_id: str
    profile_id: str
    text_preview: str
    started_at: datetime


class ActiveTasksResponse(BaseModel):
    """Response model for active tasks."""

    downloads: List[ActiveDownloadTask]
    generations: List[ActiveGenerationTask]


class AudioChannelCreate(BaseModel):
    """Request model for creating an audio channel."""

    name: str = Field(..., min_length=1, max_length=100)
    device_ids: List[str] = Field(default_factory=list)


class AudioChannelUpdate(BaseModel):
    """Request model for updating an audio channel."""

    name: Optional[str] = Field(None, min_length=1, max_length=100)
    device_ids: Optional[List[str]] = None


class AudioChannelResponse(BaseModel):
    """Response model for audio channel."""

    id: str
    name: str
    is_default: bool
    device_ids: List[str]
    created_at: datetime

    class Config:
        from_attributes = True


class ChannelVoiceAssignment(BaseModel):
    """Request model for assigning voices to a channel."""

    profile_ids: List[str]


class ProfileChannelAssignment(BaseModel):
    """Request model for assigning channels to a profile."""

    channel_ids: List[str]


class StoryCreate(BaseModel):
    """Request model for creating a story."""

    name: str = Field(..., min_length=1, max_length=100)
    description: Optional[str] = Field(None, max_length=500)


class StoryResponse(BaseModel):
    """Response model for story (list view)."""

    id: str
    name: str
    description: Optional[str]
    created_at: datetime
    updated_at: datetime
    item_count: int = 0

    class Config:
        from_attributes = True


class StoryItemDetail(BaseModel):
    """Detail model for story item with generation info."""

    id: str
    story_id: str
    generation_id: str
    version_id: Optional[str] = None
    start_time_ms: int
    track: int = 0
    trim_start_ms: int = 0
    trim_end_ms: int = 0
    created_at: datetime
    # Generation details
    profile_id: str
    profile_name: str
    text: str
    language: str
    audio_path: str
    duration: float
    seed: Optional[int]
    instruct: Optional[str]
    engine: Optional[str] = None
    volume: float = 1.0
    generation_created_at: datetime
    # Versions available for this generation
    versions: Optional[List["GenerationVersionResponse"]] = None
    active_version_id: Optional[str] = None

    class Config:
        from_attributes = True


class StoryDetailResponse(BaseModel):
    """Response model for story with items."""

    id: str
    name: str
    description: Optional[str]
    created_at: datetime
    updated_at: datetime
    items: List[StoryItemDetail] = []

    class Config:
        from_attributes = True


class StoryItemCreate(BaseModel):
    """Request model for adding a generation to a story."""

    generation_id: str
    start_time_ms: Optional[int] = None  # If not provided, will be calculated automatically
    track: Optional[int] = 0  # Track number (0 = main track)


class StoryItemUpdateTime(BaseModel):
    """Request model for updating a story item's timecode."""

    generation_id: str
    start_time_ms: int = Field(..., ge=0)


class StoryItemBatchUpdate(BaseModel):
    """Request model for batch updating story item timecodes."""

    updates: List[StoryItemUpdateTime]


class StoryItemReorder(BaseModel):
    """Request model for reordering story items."""

    generation_ids: List[str] = Field(..., min_length=1)


class StoryItemMove(BaseModel):
    """Request model for moving a story item (position and/or track)."""

    start_time_ms: int = Field(..., ge=0)
    track: int = 0


class StoryItemTrim(BaseModel):
    """Request model for trimming a story item."""

    trim_start_ms: int = Field(..., ge=0)
    trim_end_ms: int = Field(..., ge=0)


class StoryItemSplit(BaseModel):
    """Request model for splitting a story item."""

    split_time_ms: int = Field(..., ge=0)  # Time within the clip to split at (relative to clip start)


class StoryItemVersionUpdate(BaseModel):
    """Request model for setting a story item's pinned version."""

    version_id: Optional[str] = None  # null = use generation default


class StoryItemVolumeUpdate(BaseModel):
    """Request model for adjusting a story item's playback volume.

    Linear gain. ``1.0`` is the original level, ``0.0`` is silent. Capped
    above 1.0 so a too-aggressive boost can't blow out the mix or clip
    the export.
    """

    volume: float = Field(..., ge=0.0, le=2.0)


class EffectConfig(BaseModel):
    """A single effect in an effects chain."""

    type: str
    enabled: bool = True
    params: dict = Field(default_factory=dict)


class EffectsChain(BaseModel):
    """An ordered list of effects to apply."""

    effects: List[EffectConfig] = Field(default_factory=list)


class EffectPresetCreate(BaseModel):
    """Request model for creating an effect preset."""

    name: str = Field(..., min_length=1, max_length=100)
    description: Optional[str] = Field(None, max_length=500)
    effects_chain: List[EffectConfig]


class EffectPresetUpdate(BaseModel):
    """Request model for updating an effect preset."""

    name: Optional[str] = Field(None, min_length=1, max_length=100)
    description: Optional[str] = None
    effects_chain: Optional[List[EffectConfig]] = None


class EffectPresetResponse(BaseModel):
    """Response model for effect preset."""

    id: str
    name: str
    description: Optional[str] = None
    effects_chain: List[EffectConfig]
    is_builtin: bool = False
    created_at: datetime

    class Config:
        from_attributes = True


class GenerationVersionResponse(BaseModel):
    """Response model for a generation version."""

    id: str
    generation_id: str
    label: str
    audio_path: str
    effects_chain: Optional[List[EffectConfig]] = None
    source_version_id: Optional[str] = None
    is_default: bool
    created_at: datetime

    class Config:
        from_attributes = True


class ApplyEffectsRequest(BaseModel):
    """Request to apply effects to an existing generation."""

    effects_chain: List[EffectConfig]
    source_version_id: Optional[str] = Field(
        None, description="Version to use as source audio (defaults to clean/original)"
    )
    label: Optional[str] = Field(None, max_length=100, description="Label for this version (auto-generated if omitted)")
    set_as_default: bool = Field(default=True, description="Set this version as the default")


class ProfileEffectsUpdate(BaseModel):
    """Request to update the default effects chain on a profile."""

    effects_chain: Optional[List[EffectConfig]] = Field(None, description="Effects chain (null to remove)")


class AvailableEffectParam(BaseModel):
    """Description of a single effect parameter."""

    default: float
    min: float
    max: float
    step: float
    description: str


class AvailableEffect(BaseModel):
    """Description of an available effect type."""

    type: str
    label: str
    description: str
    params: dict  # param_name -> AvailableEffectParam


class AvailableEffectsResponse(BaseModel):
    """Response listing all available effect types."""

    effects: List[AvailableEffect]


# ─── Cloud (backup & sync) ──────────────────────────────────────────────


class CloudLoginStartResponse(BaseModel):
    """Returned when the desktop kicks off browser login. The backend has
    already opened the browser; the URL is included for fallback/debugging."""

    authorize_url: str


class CloudStatusResponse(BaseModel):
    """Current link between this device and a Voicebox Cloud account."""

    connected: bool
    device_name: Optional[str] = None
    account_user_id: Optional[str] = None
    key_prefix: Optional[str] = None
    connected_at: Optional[datetime] = None
    dashboard_url: str
