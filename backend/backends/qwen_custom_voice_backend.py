"""
Qwen3-TTS CustomVoice backend implementation.

Wraps the Qwen3-TTS-12Hz CustomVoice model for preset-speaker TTS with
instruction-based style control. Uses the same qwen_tts library as the
Base model (pytorch_backend.py) but loads a different checkpoint and
calls generate_custom_voice() instead of generate_voice_clone().

Key differences from the Base engine:
  - Uses preset speakers (9 built-in voices) instead of zero-shot cloning
  - Supports instruct parameter for tone/emotion/prosody control
  - Two model sizes: 1.7B and 0.6B

Languages supported: zh, en, ja, ko, de, fr, ru, pt, es, it
"""

import asyncio
import gc
import logging
import threading
import time
from typing import Optional

import numpy as np
import torch
from ..services import inference_runtime as runtime

from . import TTSBackend, LANGUAGE_CODE_TO_NAME
from .base import (
    is_model_cached,
    get_torch_device,
    combine_voice_prompts as _combine_voice_prompts,
    model_load_progress,
)

logger = logging.getLogger(__name__)

# ── Preset speakers ──────────────────────────────────────────────────

# (speaker_id, display_name, gender, native_language_code, description)
QWEN_CUSTOM_VOICES = [
    ("Vivian", "Vivian", "female", "zh", "Bright, slightly edgy young female voice"),
    ("Serena", "Serena", "female", "zh", "Warm, gentle young female voice"),
    ("Uncle_Fu", "Uncle Fu", "male", "zh", "Seasoned male voice with a low, mellow timbre"),
    ("Dylan", "Dylan", "male", "zh", "Youthful Beijing male voice with a clear, natural timbre"),
    ("Eric", "Eric", "male", "zh", "Lively Chengdu male voice with a slightly husky brightness"),
    ("Ryan", "Ryan", "male", "en", "Dynamic male voice with strong rhythmic drive"),
    ("Aiden", "Aiden", "male", "en", "Sunny American male voice with a clear midrange"),
    ("Ono_Anna", "Ono Anna", "female", "ja", "Playful Japanese female voice with a light, nimble timbre"),
    ("Sohee", "Sohee", "female", "ko", "Warm Korean female voice with rich emotion"),
]

QWEN_CV_DEFAULT_SPEAKER = "Ryan"

# CUDA memory a load needs, in MB: measured peak allocation during generation
# (bf16, RTX 3050: 0.6B = 2.05 GB resident, ~2.7 GB peak) plus headroom.
QWEN_CV_VRAM_MB = {"0.6B": 3000, "1.7B": 5200}

# HuggingFace repo IDs per model size
QWEN_CV_HF_REPOS = {
    "1.7B": "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice",
    "0.6B": "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice",
}


class QwenCustomVoiceBackend:
    """Qwen3-TTS CustomVoice backend — preset speakers with instruct control."""

    def __init__(self, model_size: str = "1.7B"):
        self.model = None
        self.model_size = model_size
        self.device = self._get_device()
        self._current_model_size: Optional[str] = None
        self._execution_config = None
        self._fast_decoder = None
        self._execution_guard = threading.RLock()
        self._peak_request = None

    def _get_device(self) -> str:
        return get_torch_device(allow_xpu=True, allow_directml=True)

    def is_loaded(self) -> bool:
        return self.model is not None

    def _get_model_path(self, model_size: str) -> str:
        if model_size not in QWEN_CV_HF_REPOS:
            raise ValueError(f"Unknown model size: {model_size}")
        return QWEN_CV_HF_REPOS[model_size]

    def _is_model_cached(self, model_size: Optional[str] = None) -> bool:
        size = model_size or self.model_size
        return is_model_cached(self._get_model_path(size))

    async def load_model_async(self, model_size: Optional[str] = None) -> None:
        if model_size is None:
            model_size = self.model_size

        await runtime.finish_thread(self._load_model_sync, model_size)

    # Alias for compatibility with the TTSBackend protocol
    load_model = load_model_async

    def _load_model_sync(self, model_size: str) -> None:
        with self._execution_guard:
            self._load_locked(model_size)

    def _load_locked(self, model_size: str) -> None:
        request_id = runtime.REQUEST_ID.get()
        if request_id and request_id != self._peak_request:
            if torch.cuda.is_initialized():
                torch.cuda.reset_peak_memory_stats()
            self._peak_request = request_id
        options = runtime.OPTIONS.get() or runtime.saved_options()
        mode, precision = options["mode"], options["precision"]
        device = "cpu" if mode == "cpu" else self._get_device()
        if mode == "cuda_only":
            if not torch.cuda.is_available():
                runtime.publish(actual="unverified", stage="failed", failure={"code": "cuda_unavailable", "message": "CUDA Only requires a CUDA-enabled PyTorch runtime and GPU."})
                raise RuntimeError("CUDA Only requires a CUDA-enabled PyTorch runtime and GPU.")
            device = "cuda:0"
        dtype = torch.float32 if device == "cpu" else (torch.float16 if precision == "fp16" else torch.bfloat16)
        efficient = bool(options.get("efficient_attention", False)) and device.startswith("cuda")
        desired = (model_size, device, dtype, mode, efficient)
        if self.model is not None and self._execution_config == desired:
            return
        self._unload_locked()
        self.device = device
        runtime.publish(stage="loading", requested=mode, actual="unverified", active=True,
                        model=f"qwen-custom-voice-{model_size}", dtype=str(dtype).removeprefix("torch."),
                        failure=None, components=[], memory=runtime.cuda_memory(device))
        started = time.perf_counter()
        try:
            if device.startswith("cuda"):
                from . import free_vram_for

                evicted = free_vram_for("qwen_custom_voice", QWEN_CV_VRAM_MB.get(model_size, 3000))
                if evicted:
                    runtime.publish(evicted_models=evicted)
            self._load_weights(model_size, dtype, explicit=mode == "cuda_only")
            if efficient:
                from .qwen_attention import install
                install(self.model)
            if device.startswith("cuda"):
                from .qwen_fast_decode import FastTalkerDecoder

                self._fast_decoder = FastTalkerDecoder.install(self.model.model)
            rows = runtime.inspect_components(self.model)
            if mode == "cuda_only" and runtime.execution_state(rows) != "cuda":
                raise runtime.RuntimePlacementError("CUDA Only rejected model components outside CUDA.")
            self._execution_config = desired
            runtime.publish(stage="loaded", actual="unverified", placement=runtime.execution_state(rows),
                            components=rows, load_seconds=time.perf_counter() - started,
                            attention="sdpa_repeat_kv" if efficient else getattr(self.model.model.config, "_attn_implementation", None),
                            memory=runtime.cuda_memory(device), active=False)
        except Exception as error:
            self._report_failure(error)
            self._unload_locked()
            raise

    def _load_weights(self, model_size, dtype, explicit=False):
        model_name = f"qwen-custom-voice-{model_size}"
        is_cached = self._is_model_cached(model_size)

        with model_load_progress(model_name, is_cached):
            from qwen_tts import Qwen3TTSModel

            model_path = self._get_model_path(model_size)
            logger.info("Loading Qwen CustomVoice %s on %s...", model_size, self.device)

            if self.device == "cpu":
                self.model = Qwen3TTSModel.from_pretrained(
                    model_path,
                    torch_dtype=dtype,
                    low_cpu_mem_usage=False,
                )
            else:
                self.model = Qwen3TTSModel.from_pretrained(
                    model_path,
                    device_map=self.device,
                    torch_dtype=dtype,
                    **({"attn_implementation": "sdpa"} if explicit else {}),
                )

        self._current_model_size = model_size
        self.model_size = model_size
        logger.info("Qwen CustomVoice %s loaded successfully", model_size)

    def unload_model(self) -> None:
        # UI/API unload is synchronous: never block the event loop behind inference.
        if not self._execution_guard.acquire(blocking=False):
            raise runtime.RuntimeBusyError("Qwen is busy. Cancel or wait for generation before unloading.")
        try:
            self._unload_locked()
            runtime.publish(stage="unloaded", active=False, actual="unverified", components=[], memory=None)
        finally:
            self._execution_guard.release()

    def _unload_locked(self):
        if self._fast_decoder is not None:
            self._fast_decoder.uninstall()
            self._fast_decoder = None
        if self.model is not None:
            del self.model
            self.model = None
            self._current_model_size = None
            self._execution_config = None

            gc.collect()  # anything still cyclic (HF hooks, caches) must go before empty_cache
            if torch.cuda.is_available():
                torch.cuda.empty_cache()

            logger.info("Qwen CustomVoice unloaded")

    def _report_failure(self, error):
        oom = isinstance(error, torch.cuda.OutOfMemoryError)
        runtime.publish(stage="failed", actual="cuda_oom" if oom else "unverified", active=False,
                        memory=runtime.cuda_memory(self.device),
                        failure={"code": "cuda_oom" if oom else "execution_error", "message": str(error)})

    async def create_voice_prompt(
        self,
        audio_path: str,
        reference_text: str,
        use_cache: bool = True,
    ) -> tuple[dict, bool]:
        """
        Create voice prompt for CustomVoice.

        CustomVoice doesn't use reference audio — it uses preset speakers.
        When called for a cloned profile (fallback), uses the default speaker.
        For preset profiles, the voice_prompt dict is built by the profile
        service and bypasses this method entirely.
        """
        return {
            "voice_type": "preset",
            "preset_engine": "qwen_custom_voice",
            "preset_voice_id": QWEN_CV_DEFAULT_SPEAKER,
        }, False

    async def combine_voice_prompts(
        self,
        audio_paths: list[str],
        reference_texts: list[str],
    ) -> tuple[np.ndarray, str]:
        return await _combine_voice_prompts(audio_paths, reference_texts)

    async def generate(
        self,
        text: str,
        voice_prompt: dict,
        language: str = "en",
        seed: Optional[int] = None,
        instruct: Optional[str] = None,
    ) -> tuple[np.ndarray, int]:
        """
        Generate audio using Qwen CustomVoice.

        Args:
            text: Text to synthesize
            voice_prompt: Dict with preset_voice_id (speaker name)
            language: Language code (zh, en, ja, ko, etc.)
            seed: Random seed for reproducibility
            instruct: Natural language instruction for style control
                      (e.g. "Speak in an angry tone", "Very happy")

        Returns:
            Tuple of (audio_array, sample_rate)
        """
        speaker = voice_prompt.get("preset_voice_id") or QWEN_CV_DEFAULT_SPEAKER

        def _generate_sync():
            if seed is not None:
                torch.manual_seed(seed)
                if torch.cuda.is_available():
                    torch.cuda.manual_seed(seed)

            lang_name = LANGUAGE_CODE_TO_NAME.get(language, "auto")

            kwargs = {
                "text": text,
                "language": lang_name.capitalize() if lang_name != "auto" else "Auto",
                "speaker": speaker,
            }

            # Only pass instruct if non-empty
            if instruct:
                kwargs["instruct"] = instruct

            # Inference runs with the process's default HF_HUB_OFFLINE
            # state. Forcing offline here (issue #462) regressed online
            # users whose libraries issue legitimate metadata lookups
            # during generation.
            started = time.perf_counter()
            config = self._execution_config
            runtime.publish(stage="generating", active=True, speaker=speaker,
                            memory=runtime.cuda_memory(self.device), failure=None,
                            dtype=str(config[2]).removeprefix("torch.") if config else None,
                            attention="sdpa_repeat_kv" if config and config[4]
                            else getattr(self.model.model.config, "_attn_implementation", None))
            options = runtime.OPTIONS.get() or {}
            decoder = self._fast_decoder
            if decoder is not None:
                decoder.enabled = bool(options.get("fast_decode", True))
            with runtime.ObserveExecution(self.model, strict=options.get("mode") == "cuda_only") as observed:
                wavs, sample_rate = self.model.generate_custom_voice(**kwargs)
                decode = decoder.last_run if decoder is not None else None
                if decode is not None and decode.path == "cuda_graph":
                    # Only the predictor bypasses hooks. The stock talker's
                    # device is observed normally, not inferred from this graph.
                    observed.mark_executed(("talker.code_predictor",),
                                           str(self.device))
            elapsed = time.perf_counter() - started
            if decode is not None:
                runtime.publish(decoder={
                    "path": decode.path, "reason": decode.reason, "frames": decode.frames,
                    "frames_per_second": decode.frames_per_s, "capture_seconds": decode.capture_s,
                    "static_cache_bytes": decoder.static_bytes(),
                    "strategy": decode.extra.get("strategy"),
                })
            runtime.publish(stage="audio_ready", active=False, generation_seconds=elapsed,
                            audio_seconds=len(wavs[0]) / sample_rate,
                            memory=runtime.cuda_memory(self.device))
            return wavs[0], sample_rate

        def guarded():
            with self._execution_guard:
                try:
                    options = runtime.OPTIONS.get() or runtime.saved_options()
                    token = runtime.OPTIONS.set(options)
                    try:
                        self._load_locked(options.get("model_size") or self.model_size)
                        return _generate_sync()
                    finally:
                        runtime.OPTIONS.reset(token)
                        # Return cached-but-unused blocks to the driver. On a 4 GB
                        # card PyTorch's cache otherwise grows run over run
                        # (measured 2.9 → 3.3 GB reserved) until Windows starts
                        # spilling into shared system memory.
                        if str(self.device).startswith("cuda"):
                            torch.cuda.empty_cache()
                except Exception as error:
                    self._report_failure(error)
                    raise

        audio, sample_rate = await runtime.finish_thread(guarded)
        return audio, sample_rate
