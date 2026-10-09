"""Compare installed Standard and Fast through the normal queued app path."""
import io
import json
from pathlib import Path
import time
from urllib.request import Request, urlopen

import numpy as np
import soundfile as sf

BASE = "http://127.0.0.1:17497"
OUT = Path(__file__).resolve().parents[1] / ".codex/benchmarks/ryan-long-comparison"


def call(path, body=None, timeout=30):
    request = Request(BASE + path, data=json.dumps(body).encode() if body is not None else None,
                      headers={"Content-Type": "application/json"})
    with urlopen(request, timeout=timeout) as response:
        return response.read()


def main():
    text = (OUT / "input.txt").read_text(encoding="utf-8").strip()
    assert len(text) >= 2000, len(text)
    for attempt in range(90):
        try:
            call("/health", timeout=3)
            break
        except OSError:
            time.sleep(2)
    else:
        raise RuntimeError("Installed backend did not become ready")
    profile = json.loads(call("/voices/activate", {"engine": "qwen_custom_voice", "voice_id": "Ryan"}))
    results = {}
    waves = {}
    print(json.dumps({"characters": len(text), "speaker": "Ryan", "seed": 11,
                      "chunk_limit": 800, "crossfade_ms": 50}), flush=True)
    for name, fast in [("standard", False), ("fast", True)]:
        request = {
            "profile_id": profile["profile_id"], "text": text,
            "engine": "qwen_custom_voice", "model_size": "0.6B", "language": "en",
            "seed": 11, "speed": 1.0, "max_chunk_chars": 800, "crossfade_ms": 50,
            "qwen_execution": {"mode": "cuda_only", "precision": "bf16",
                               "fast_decode": fast, "efficient_attention": False},
            "preprocessing": {"normalize_whitespace": True, "smart_numbers": False,
                              "lowercase": False, "fix_initials": True,
                              "remove_reference_numbers": True, "sentence_pause_ms": 0,
                              "replacements": []},
            "postprocessing": {"loudness": "broadcast", "target_lufs": -16,
                               "remove_silence": False}, "effects_chain": [],
        }
        started = time.perf_counter()
        job = json.loads(call("/generate", request))
        job_id = job["id"]
        print(json.dumps({"mode": name, "job": job_id, "submitted": True}), flush=True)
        samples = []
        next_print = 0
        while time.perf_counter() - started < 2400:
            item = json.loads(call("/history/" + job_id))
            resources = json.loads(call("/system/resources"))
            samples.append(resources)
            elapsed = time.perf_counter() - started
            if elapsed >= next_print:
                runtime = resources.get("runtime") or resources.get("inference") or {}
                print(json.dumps({"mode": name, "elapsed": round(elapsed, 1),
                                  "status": item["status"], "stage": runtime.get("stage"),
                                  "decoder": runtime.get("decoder"),
                                  "gpu": resources.get("gpu_percent")}), flush=True)
                next_print = elapsed + 30
            if item["status"] == "failed":
                raise RuntimeError(json.dumps(item))
            if item["status"] == "completed":
                break
            time.sleep(4)
        else:
            raise TimeoutError("Long generation exceeded 40 minutes")
        raw = call("/history/" + job_id + "/export-audio")
        (OUT / (name + ".wav")).write_bytes(raw)
        audio, sr = sf.read(io.BytesIO(raw), dtype="float32")
        assert np.isfinite(audio).all() and len(audio) > 0
        waves[name] = (audio, sr)
        result = {"job": job_id, "request": request, "generation": item,
                  "wall_seconds": time.perf_counter() - started,
                  "audio_seconds": len(audio) / sr, "sample_rate": sr,
                  "peak_amplitude": float(np.max(np.abs(audio))),
                  "finite": True, "resource_samples": samples}
        results[name] = result
        (OUT / (name + ".json")).write_text(json.dumps(result, indent=2), encoding="utf-8")
        print(json.dumps({"completed": name, "audio_seconds": result["audio_seconds"],
                          "load_seconds": item.get("load_seconds"),
                          "generation_seconds": item.get("generation_seconds")}), flush=True)
    a, a_sr = waves["standard"]
    b, b_sr = waves["fast"]
    comparison = {"characters": len(text), "same_sample_rate": a_sr == b_sr,
                  "standard_samples": len(a), "fast_samples": len(b),
                  "exact_waveform_match": bool(a_sr == b_sr and np.array_equal(a, b))}
    if a_sr == b_sr and a.shape == b.shape:
        comparison["max_abs_difference"] = float(np.max(np.abs(a - b)))
    comparison["speedup"] = (results["standard"]["generation"]["generation_seconds"] /
                             results["fast"]["generation"]["generation_seconds"])
    (OUT / "comparison.json").write_text(json.dumps(comparison, indent=2), encoding="utf-8")
    print(json.dumps({"comparison": comparison}), flush=True)


if __name__ == "__main__":
    main()
