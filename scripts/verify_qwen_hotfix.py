"""Exercise a separately launched hotfix server using an isolated data folder."""
import io
import json
from pathlib import Path
import time
from urllib.request import Request, urlopen

import numpy as np
import soundfile as sf

BASE = "http://127.0.0.1:17497"
ROOT = Path(__file__).resolve().parents[1]


def call(path, body=None):
    request = Request(BASE + path, data=json.dumps(body).encode() if body is not None else None,
                      headers={"Content-Type": "application/json"})
    with urlopen(request, timeout=300) as response:
        return response.read()


def main():
    for attempt in range(90):
        try:
            with urlopen(BASE + "/health", timeout=3) as response:
                health = json.load(response)
            print("health", health, flush=True)
            break
        except OSError:
            time.sleep(2)
    else:
        raise RuntimeError("Candidate server did not become ready")
    profile = json.loads(call("/voices/activate", {"engine": "qwen_custom_voice", "voice_id": "Ryan"}))
    text = "Welcome back to the workshop. Today we are going to walk through the complete setup, from unpacking the parts to running the very first test. Along the way, I will point out the two mistakes almost everyone makes, and show you exactly how to avoid them. Let's get started right now."
    started = time.perf_counter()
    raw = call("/generate/stream", {
        "profile_id": profile["profile_id"], "text": text, "engine": "qwen_custom_voice",
        "model_size": "0.6B", "language": "en", "seed": 11, "speed": 1.0,
        "qwen_execution": {"mode": "cuda_only", "precision": "bf16", "fast_decode": True,
                           "efficient_attention": False},
        "postprocessing": {"loudness": "off", "remove_silence": False}, "effects_chain": [],
    })
    elapsed = time.perf_counter() - started
    audio, sr = sf.read(io.BytesIO(raw), dtype="float32")
    output = ROOT / ".codex/benchmarks/ryan-corrected-audio/packaged_api.wav"
    sf.write(output, audio, sr, subtype="FLOAT")
    reference, reference_sr = sf.read(output.parent / "stock.wav", dtype="float32")
    assert sr == reference_sr
    assert audio.shape == reference.shape, (audio.shape, reference.shape)
    difference = float(np.max(np.abs(audio - reference)))
    # The API returns PCM16 WAV, the reference is float32 WAV.
    assert difference <= 1 / 32768 + 1e-7, difference
    assert np.isfinite(audio).all()
    resources = json.loads(call("/system/resources"))
    print("packaged_api", {"seconds": elapsed, "audio_seconds": len(audio)/sr,
                           "max_difference_vs_stock": difference}, flush=True)
    print("runtime", json.dumps(resources), flush=True)
    for path in ["/history?group_by=profile", "/stories", "/settings/generation"]:
        call(path)
        print("API smoke passed", path, flush=True)


if __name__ == "__main__":
    main()
