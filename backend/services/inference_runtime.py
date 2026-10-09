"""Observed Qwen runtime state. No device is inferred from CPU utilisation.

Snapshots contain metadata only (never tensors or text). CUDA counters are
process-wide; Windows driver residency is deliberately reported as unknown.
"""
from __future__ import annotations

import asyncio
import copy
import threading
import time
import functools
import inspect
import uuid
from contextvars import ContextVar
from datetime import datetime, timezone

OPTIONS: ContextVar[dict | None] = ContextVar("qwen_execution_options", default=None)
JOB_ID: ContextVar[str | None] = ContextVar("qwen_job_id", default=None)
REQUEST_ID: ContextVar[str | None] = ContextVar("qwen_request_id", default=None)
_lock = threading.RLock()
_latest: dict | None = None
_jobs: dict[str, dict] = {}


def publish(**values):
    global _latest
    with _lock:
        job_id = JOB_ID.get()
        previous = _jobs.get(job_id, {}) if job_id else (_latest or {})
        snapshot = {**previous, **values, "job_id": job_id,
                    "observed_at": datetime.now(timezone.utc).isoformat()}
        _latest = snapshot
        if job_id:
            _jobs[job_id] = snapshot
            while len(_jobs) > 64:
                del _jobs[next(iter(_jobs))]
        return copy.deepcopy(snapshot)


def snapshot(job_id=None):
    with _lock:
        return copy.deepcopy(_jobs.get(job_id) if job_id else _latest)


def saved_options():
    from ..database import get_db
    from .settings import get_generation_settings, generation_settings_to_response

    db = next(get_db())
    try:
        return generation_settings_to_response(get_generation_settings(db)).qwen_execution.model_dump()
    finally:
        db.close()


def qwen_job(fn):
    """Capture defaults at submission, before a queued coroutine starts."""
    @functools.wraps(fn)
    def submitted(*args, **kwargs):
        options = kwargs.pop("qwen_execution", None)
        bound = inspect.signature(fn).bind_partial(*args, **kwargs).arguments
        engine = bound.get("engine")
        if engine == "qwen_custom_voice":
            options = options.model_dump() if hasattr(options, "model_dump") else options
            options = {**(options or saved_options()), "model_size": bound.get("model_size")}

        async def run():
            if engine != "qwen_custom_voice":
                return await fn(*args, **kwargs)
            token = OPTIONS.set(options)
            job_token = JOB_ID.set(kwargs.get("generation_id"))
            request_token = REQUEST_ID.set(uuid.uuid4().hex)
            publish(stage="starting", requested=options["mode"], actual="unverified",
                    components=[], failure=None, active=True, backend="qwen_tts / PyTorch",
                    quantization="none", memory=None,
                    cpu_stages=["text preparation", "audio conversion", "post-processing"])
            try:
                return await fn(*args, **kwargs)
            finally:
                publish(active=False)
                OPTIONS.reset(token)
                JOB_ID.reset(job_token)
                REQUEST_ID.reset(request_token)
        return run()
    return submitted


def cuda_memory(device="cuda:0"):
    import torch

    if not str(device).startswith("cuda") or not torch.cuda.is_initialized():
        return None
    try:
        free, total = torch.cuda.mem_get_info(device)
        return {
            "allocated_bytes": torch.cuda.memory_allocated(device),
            "reserved_bytes": torch.cuda.memory_reserved(device),
            "peak_allocated_bytes": torch.cuda.max_memory_allocated(device),
            "peak_reserved_bytes": torch.cuda.max_memory_reserved(device),
            "free_bytes": free, "total_bytes": total,
            "scope": "process", "driver_residency": "unverified",
        }
    except (RuntimeError, AssertionError):
        return None


def component_modules(wrapper):
    """The codec wrapper is not necessarily a registered torch submodule."""
    inner = wrapper.model
    result = []
    for name, child in inner.named_children():
        if name == "talker":
            result.extend((f"talker.{n}", m) for n, m in child.named_children())
        else:
            result.append((name, child))
    codec = getattr(getattr(inner, "speech_tokenizer", None), "model", None)
    if codec is not None:
        result.extend((f"speech_tokenizer.model.{n}", m) for n, m in codec.named_children())
    return result


def inspect_components(wrapper):
    seen = set()
    rows = []
    for name, module in component_modules(wrapper):
        devices, dtypes, size = set(), set(), 0
        for tensor in list(module.parameters()) + list(module.buffers()):
            devices.add(str(tensor.device))
            dtypes.add(str(tensor.dtype).removeprefix("torch."))
            storage = tensor.untyped_storage()
            key = (str(tensor.device), storage.data_ptr(), storage.nbytes())
            if key not in seen:
                size += storage.nbytes()
                seen.add(key)
        hooks = []
        for subname, sub in module.named_modules():
            hook = getattr(sub, "_hf_hook", None)
            if hook is not None:
                hooks.append({"module": subname, "type": type(hook).__name__,
                              "offload": bool(getattr(hook, "offload", False))})
        rows.append({"name": name, "devices": sorted(devices), "dtypes": sorted(dtypes),
                     "storage_bytes": size, "hooks": hooks, "executed": False,
                     "input_devices": [], "output_devices": []})
    return rows


def tensor_devices(value):
    import torch

    if isinstance(value, torch.Tensor):
        return {str(value.device)}
    if isinstance(value, dict):
        return set().union(*(tensor_devices(v) for v in value.values())) if value else set()
    if isinstance(value, (tuple, list)):
        return set().union(*(tensor_devices(v) for v in value)) if value else set()
    if type(value).__module__ == "transformers.cache_utils" and hasattr(value, "layers"):
        return tensor_devices([(getattr(layer, "keys", None), getattr(layer, "values", None)) for layer in value.layers])
    return set()


def execution_state(rows, *, observed=False):
    selected = [r for r in rows if r.get("executed")] if observed else rows
    devices = {d.split(":")[0] for r in selected for d in
               (r["devices"] + r.get("input_devices", []) + r.get("output_devices", []))}
    if not devices:
        return "unverified"
    if devices == {"cuda"}:
        return "cuda"
    if devices == {"cpu"}:
        return "cpu"
    return "mixed"


class RuntimePlacementError(RuntimeError):
    pass


class RuntimeBusyError(RuntimeError):
    pass


async def finish_thread(fn, *args):
    """Cancellation cannot detach an inference thread from its queue lease."""
    task = asyncio.create_task(asyncio.to_thread(fn, *args))
    cancelled = False
    while True:
        try:
            result = await asyncio.shield(task)
            break
        except asyncio.CancelledError:
            cancelled = True
            if task.done():
                break
        except Exception:
            if cancelled:
                raise asyncio.CancelledError from None
            raise
    if cancelled:
        # Retrieve exceptions even when cancellation raced with completion.
        if task.done() and not task.cancelled():
            task.exception()
        raise asyncio.CancelledError
    return result


class ObserveExecution:
    """Boundary hooks are evidence of execution, not a CUDA kernel profiler."""
    def __init__(self, wrapper, strict=False):
        self.wrapper, self.strict = wrapper, strict
        self.rows = inspect_components(wrapper)
        self.handles = []
        self.started = time.perf_counter()
        self.first_code_seconds = None

    def __enter__(self):
        for (name, module), row in zip(component_modules(self.wrapper), self.rows):
            def before(mod, args, kwargs, row=row):
                devices = tensor_devices((args, kwargs))
                changed = not row["executed"] or not devices.issubset(row["input_devices"])
                row["input_devices"] = sorted(set(row["input_devices"]) | devices)
                row["executed"] = True
                if self.strict and any(not d.startswith("cuda") for d in devices | set(row["devices"])):
                    raise RuntimePlacementError(f"CUDA Only rejected non-CUDA tensors in {row['name']}")
                if changed:
                    publish(stage="decoding" if "decoder" in row["name"] else "generating",
                            components=self.rows, actual=execution_state(self.rows, observed=True))

            def after(mod, args, output, row=row):
                # Inspect output once per component, keeping live overhead bounded.
                if not row["output_devices"]:
                    row["output_devices"] = sorted(tensor_devices(output))
                if self.strict and any(not d.startswith("cuda") for d in row["output_devices"]):
                    raise RuntimePlacementError(f"CUDA Only rejected CPU output in {row['name']}")
                if row["name"] == "talker.codec_head" and self.first_code_seconds is None:
                    # This is logits availability on host, not completed CUDA work.
                    self.first_code_seconds = time.perf_counter() - self.started

            self.handles.append(module.register_forward_pre_hook(before, with_kwargs=True))
            self.handles.append(module.register_forward_hook(after))
        return self

    def mark_executed(self, names, device):
        """Record execution that bypassed module hooks (e.g. CUDA-graph replay)."""
        for row in self.rows:
            if row["name"] in names:
                row["executed"] = True
                row["input_devices"] = sorted(set(row["input_devices"]) | {device})
                row["output_devices"] = sorted(set(row["output_devices"]) | {device})

    def __exit__(self, *exc):
        for handle in self.handles:
            handle.remove()
        publish(components=self.rows, actual=execution_state(self.rows, observed=True))
