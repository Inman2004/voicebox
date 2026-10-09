"""Reproducible Ryan benchmark using Voicebox's backend and render pipeline.

Run from the repository root with the CUDA backend's Python:
  python -m scripts.benchmark_qwen_cuda --mode cuda_only --precision bf16 --out PATH
Profiler runs are diagnostic only, never compare their wall time to benchmarks.
"""
from __future__ import annotations

import argparse
import asyncio
import importlib.metadata
import json
import statistics
import subprocess
import threading
import time
from pathlib import Path

import numpy as np
import psutil
import torch

from backend.backends.qwen_custom_voice_backend import QwenCustomVoiceBackend
from backend.models import PreprocessingOptions, PostprocessingOptions
from backend.services import inference_runtime as runtime
from backend.services.render import render_speech
from backend.utils.audio import save_audio

WORKSHOP = ("Welcome back to the workshop. Today we're going to walk through the full setup, "
            "from unpacking the parts to running the first test, and I'll point out the two "
            "mistakes almost everyone makes along the way.")
TEXTS = {"short": "Hello, I'm Ryan. Let's make this workflow faster and more reliable.",
         "workshop": WORKSHOP, "long": " ".join([WORKSHOP] * 5)}


class Sampler:
    def __init__(self):
        self.stop = threading.Event()
        self.samples = []
        self.thread = threading.Thread(target=self.run, daemon=True)

    def run(self):
        proc = psutil.Process()
        proc.cpu_percent()
        psutil.cpu_percent()
        try:
            import pynvml
            pynvml.nvmlInit()
            handle = pynvml.nvmlDeviceGetHandleByIndex(0)
        except Exception:
            handle = None
        while not self.stop.wait(0.1):
            item = {"process_cpu_percent": proc.cpu_percent() / psutil.cpu_count(),
                    "system_cpu_percent": psutil.cpu_percent(), "rss_bytes": proc.memory_info().rss}
            if handle is not None:
                item["gpu_percent"] = pynvml.nvmlDeviceGetUtilizationRates(handle).gpu
                item["device_used_bytes"] = pynvml.nvmlDeviceGetMemoryInfo(handle).used
            self.samples.append(item)

    def finish(self):
        self.stop.set()
        self.thread.join()
        keys = {k for sample in self.samples for k in sample}
        return {k: {"average": statistics.mean(s[k] for s in self.samples if k in s),
                    "peak": max(s[k] for s in self.samples if k in s)} for k in keys}


async def main(args):
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    runtime.OPTIONS.set({"mode": args.mode, "precision": args.precision, "model_size": "0.6B",
                         "efficient_attention": args.efficient_attention})
    backend = QwenCustomVoiceBackend("0.6B")
    result = {"arguments": vars(args), "revision": subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip(),
              "versions": {k: importlib.metadata.version(k) for k in ["torch", "transformers", "accelerate", "qwen-tts"]},
              "gpu": torch.cuda.get_device_name(0), "runs": [], "phases": []}

    def persist():
        (out / "results.json").write_text(json.dumps(result, indent=2, allow_nan=False), encoding="utf-8")

    def phase(name):
        result["phases"].append({"name": name, "memory": runtime.cuda_memory(),
                                 "rss_bytes": psutil.Process().memory_info().rss})

    torch.cuda.init()
    phase("cuda_initialized")
    start = time.perf_counter()
    await backend.load_model_async("0.6B")
    result["load_seconds"] = time.perf_counter() - start
    result["components"] = runtime.inspect_components(backend.model)
    result["model_revision"] = getattr(backend.model.model.config, "_commit_hash", None)
    result["attention"] = backend.model.model.config._attn_implementation
    phase("model_loaded")
    prompt = {"voice_type": "preset", "preset_engine": "qwen_custom_voice", "preset_voice_id": "Ryan"}
    phase("speaker_selected")
    stage = {}
    inner = backend.model.model
    original_generate, original_decode = inner.generate, inner.speech_tokenizer.decode

    def timed_generate(*a, **kw):
        torch.cuda.synchronize()
        started = time.perf_counter()
        value = original_generate(*a, **kw)
        torch.cuda.synchronize()
        stage["talker_seconds"] = stage.get("talker_seconds", 0) + time.perf_counter() - started
        stage["audio_frames"] = stage.get("audio_frames", 0) + int(value[0][0].shape[0])
        return value

    def timed_decode(*a, **kw):
        torch.cuda.synchronize()
        started = time.perf_counter()
        value = original_decode(*a, **kw)
        torch.cuda.synchronize()
        stage["decode_seconds"] = stage.get("decode_seconds", 0) + time.perf_counter() - started
        return value

    inner.generate, inner.speech_tokenizer.decode = timed_generate, timed_decode
    first_start = [0.0]
    def first_code(mod, inputs, kwargs):
        # The next decoder step receives the first sampled code as input_ids.
        # Prefill has inputs_embeds, not a sampled audio code.
        if kwargs.get("input_ids") is not None and "first_code_seconds" not in stage:
            torch.cuda.synchronize()
            stage["first_code_seconds"] = time.perf_counter() - first_start[0]
    hook = inner.talker.register_forward_pre_hook(first_code, with_kwargs=True)

    prof = None
    if args.profile:
        # At most two code predictor calls (30 generated code tokens), not a
        # full utterance. This avoids the previous unbounded trace's RAM cost.
        from torch.profiler import profile, ProfilerActivity
        original_predict = inner.talker.code_predictor.generate
        count = [0]
        def bounded_predict(*a, **kw):
            nonlocal prof
            count[0] += 1
            if count[0] == 2:
                prof = profile(activities=[ProfilerActivity.CPU, ProfilerActivity.CUDA])
                prof.start()
            value = original_predict(*a, **kw)
            if count[0] == 3:
                prof.stop()
            return value
        inner.talker.code_predictor.generate = bounded_predict

    persist()
    for i in range(args.runs + 1):
        stage.clear()
        torch.cuda.reset_peak_memory_stats()
        phase(f"before_run_{i}")
        sample = Sampler()
        sample.thread.start()
        first_start[0] = time.perf_counter()
        try:
            audio, sr = await render_speech(backend, engine="qwen_custom_voice", text=TEXTS[args.text],
                voice_prompt=prompt, language="en", seed=1234 + (max(1, i) - 1) % 5,
                preprocessing=PreprocessingOptions(), postprocessing=PostprocessingOptions(),
                max_chunk_chars=800, crossfade_ms=50)
            ready = time.perf_counter() - first_start[0]
            save_start = time.perf_counter()
            save_audio(audio, str(out / f"{i:02}.wav"), sr)
            row = {"run": i, "warmup": i == 0, "seed": 1234 + (max(1, i) - 1) % 5,
                   "first_playable_audio_seconds": ready, "save_seconds": time.perf_counter() - save_start,
                   "wall_seconds": time.perf_counter() - first_start[0], "audio_seconds": len(audio) / sr,
                   "rtf": ready / (len(audio) / sr), "finite_audio": bool(np.isfinite(audio).all()),
                   **stage, "memory": runtime.cuda_memory(), "diagnostics": runtime.snapshot()}
        finally:
            util = sample.finish()
        row["utilization"] = util
        result["runs"].append(row)
        phase(f"after_run_{i}")
        persist()
        print(json.dumps({k: row[k] for k in ("run", "wall_seconds", "audio_seconds", "rtf", "first_code_seconds")}), flush=True)
    hook.remove()
    if prof is not None:
        (out / "profile.txt").write_text(prof.key_averages().table(sort_by="self_cpu_time_total", row_limit=35), encoding="utf-8")
        prof.export_chrome_trace(str(out / "trace.json"))
    result["components_after"] = runtime.snapshot()["components"]
    persist()
    backend.unload_model()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mode", choices=["auto", "cuda_only", "cpu"], default="auto")
    parser.add_argument("--precision", choices=["auto", "bf16", "fp16"], default="auto")
    parser.add_argument("--text", choices=list(TEXTS), default="workshop")
    parser.add_argument("--runs", type=int, default=5)
    parser.add_argument("--profile", action="store_true")
    parser.add_argument("--efficient-attention", action="store_true")
    parser.add_argument("--out", required=True)
    asyncio.run(main(parser.parse_args()))
