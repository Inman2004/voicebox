"""Live system resource usage for the sidebar Resources widget."""

import logging
import os
import threading
from typing import Optional

from fastapi import APIRouter

from .. import models

logger = logging.getLogger(__name__)

router = APIRouter()

_nvml_lock = threading.Lock()
_nvml_state: dict = {"initialized": False, "failed": False, "handle": None, "name": None}


def _nvml_handle():
    """Lazily initialise NVML once; returns None when unavailable."""
    with _nvml_lock:
        if _nvml_state["failed"]:
            return None
        if not _nvml_state["initialized"]:
            try:
                import pynvml

                pynvml.nvmlInit()
                index = 0
                visible = os.environ.get("CUDA_VISIBLE_DEVICES")
                if visible and visible.split(",")[0].strip().isdigit():
                    index = int(visible.split(",")[0])
                handle = pynvml.nvmlDeviceGetHandleByIndex(index)
                name = pynvml.nvmlDeviceGetName(handle)
                _nvml_state.update(
                    initialized=True,
                    handle=handle,
                    name=name.decode() if isinstance(name, bytes) else name,
                )
            except Exception as e:  # no NVIDIA driver, pynvml missing, etc.
                logger.debug("NVML unavailable: %s", e)
                _nvml_state["failed"] = True
                return None
        return _nvml_state["handle"]


def _gpu_stats() -> tuple[Optional[float], Optional[str], Optional[float], Optional[float]]:
    """Return (util %, name, vram used MB, vram total MB)."""
    handle = _nvml_handle()
    if handle is not None:
        try:
            import pynvml

            util = pynvml.nvmlDeviceGetUtilizationRates(handle).gpu
            mem = pynvml.nvmlDeviceGetMemoryInfo(handle)
            return float(util), _nvml_state["name"], mem.used / 2**20, mem.total / 2**20
        except Exception:
            pass

    # Non-NVIDIA fallback: torch can report memory but not utilisation.
    try:
        import torch

        if torch.cuda.is_available():
            free, total = torch.cuda.mem_get_info()
            return None, torch.cuda.get_device_name(0), (total - free) / 2**20, total / 2**20
        if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
            used = torch.mps.current_allocated_memory() / 2**20
            return None, "Apple GPU", used, None
    except Exception:
        pass
    return None, None, None, None


def _loaded_models() -> list[str]:
    from .. import backends
    from ..backends import TTS_ENGINES, check_model_loaded, get_all_model_configs

    loaded = []
    for cfg in get_all_model_configs():
        # Don't instantiate (and import) an engine just to learn it's idle.
        if cfg.engine in TTS_ENGINES and cfg.engine not in backends._tts_backends:
            continue
        try:
            if check_model_loaded(cfg):
                loaded.append(cfg.display_name)
        except Exception:
            continue
    return loaded


@router.get("/system/resources", response_model=models.SystemResourcesResponse)
async def get_system_resources():
    cpu_percent = app_ram = sys_used = sys_total = None
    try:
        import psutil

        # interval=None compares against the previous call — non-blocking,
        # and accurate once the widget polls at a steady rate.
        cpu_percent = psutil.cpu_percent(interval=None)
        proc = psutil.Process()
        rss = proc.memory_info().rss
        for child in proc.children(recursive=True):
            try:
                rss += child.memory_info().rss
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                pass
        app_ram = rss / 2**20
        vm = psutil.virtual_memory()
        sys_used, sys_total = (vm.total - vm.available) / 2**20, vm.total / 2**20
    except ImportError:
        logger.debug("psutil not installed; CPU/RAM stats unavailable")

    gpu_percent, gpu_name, vram_used, vram_total = _gpu_stats()

    return models.SystemResourcesResponse(
        cpu_percent=cpu_percent,
        app_ram_mb=app_ram,
        system_ram_used_mb=sys_used,
        system_ram_total_mb=sys_total,
        gpu_percent=gpu_percent,
        gpu_name=gpu_name,
        vram_used_mb=vram_used,
        vram_total_mb=vram_total,
        loaded_models=_loaded_models(),
    )
