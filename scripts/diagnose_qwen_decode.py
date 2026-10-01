"""Compare Ryan decoder output with fixed seeds and reused CUDA graphs.

Run in the Qwen CUDA environment. Short bounded code tests are diagnostics,
not listening or full speech quality validation.
"""
import argparse
import hashlib
import json
from pathlib import Path
import sys
import time
from contextlib import nullcontext

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import torch
from qwen_tts import Qwen3TTSModel
from backend.backends.qwen_fast_decode import FastTalkerDecoder


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--steps", type=int, default=64)
    parser.add_argument("--math-attention", action="store_true")
    parser.add_argument("--predictor-only", action="store_true")
    parser.add_argument("--legacy-full-frame", action="store_true")
    parser.add_argument("--audio-dir", type=Path)
    args = parser.parse_args()
    model = Qwen3TTSModel.from_pretrained(
        "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice",
        device_map="cuda:0", torch_dtype=torch.bfloat16,
        local_files_only=True,
    )
    decoder = FastTalkerDecoder.install(model.model)
    if args.legacy_full_frame:
        decoder._fast = decoder._legacy_fast
    if args.audio_dir:
        import numpy as np
        import soundfile as sf
        args.audio_dir.mkdir(parents=True, exist_ok=True)
        text = "Welcome back to the workshop. Today we are going to walk through the complete setup, from unpacking the parts to running the very first test. Along the way, I will point out the two mistakes almost everyone makes, and show you exactly how to avoid them. Let's get started right now."
        audios = {}
        for label, fast in [("stock", False), ("corrected_fast", True), ("corrected_fast_repeat", True)]:
            decoder.enabled = fast
            torch.manual_seed(11)
            torch.cuda.synchronize()
            started = time.perf_counter()
            waves, sr = model.generate_custom_voice(text=text, language="English", speaker="Ryan")
            torch.cuda.synchronize()
            audio = np.asarray(waves[0])
            audios[label] = audio
            sf.write(args.audio_dir / (label + ".wav"), audio, sr, subtype="FLOAT")
            print(json.dumps({"audio": label, "generation_seconds": time.perf_counter() - started,
                              "audio_seconds": len(audio) / sr, "path": decoder.last_run.path,
                              "finite": bool(np.isfinite(audio).all())}), flush=True)
        for label in ["corrected_fast", "corrected_fast_repeat"]:
            equal = np.array_equal(audios['stock'], audios[label])
            print(json.dumps({"audio_equal_to_stock": label, "equal": equal}), flush=True)
        decoder.uninstall()
        return
    captured = {}
    original = decoder._orig_generate

    def capture(**kwargs):
        captured.update(kwargs)
        return original(**kwargs)

    decoder._orig_generate = capture
    decoder.enabled = False
    model.generate_custom_voice(
        text="Welcome back to the workshop. Today we will learn how everything connects.",
        language="English", speaker="Ryan", max_new_tokens=2,
    )
    decoder._orig_generate = original
    if args.predictor_only:
        from backend.backends.qwen_fast_predictor import FastCodePredictor
        predictor = FastCodePredictor(model.model.talker.code_predictor)
        stock_predictor = model.model.talker.code_predictor.generate
        def predictor_decode(kw):
            model.model.talker.code_predictor.generate = predictor.generate
            try:
                return original(**kw)
            finally:
                model.model.talker.code_predictor.generate = stock_predictor
        decoder._fast = predictor_decode
        decoder.release = predictor.release
    kwargs = dict(captured, max_new_tokens=args.steps)
    results = {}

    def run(label, fast, sample, seed=11):
        decoder.enabled = fast
        torch.manual_seed(seed)
        torch.cuda.synchronize()
        started = time.perf_counter()
        attention = (torch.nn.attention.sdpa_kernel(torch.nn.attention.SDPBackend.MATH)
                     if args.math_attention else nullcontext())
        with torch.inference_mode(), attention:
            output = decoder.generate(**dict(kwargs, do_sample=sample, subtalker_dosample=sample))
        codes = torch.cat([codes for _, codes in output.hidden_states if codes is not None], dim=0).cpu()
        elapsed = time.perf_counter() - started
        results[label] = codes
        print(json.dumps({"run": label, "path": decoder.last_run.path,
                          "frames": len(codes), "seconds": round(elapsed, 3),
                          "hash": hashlib.sha256(codes.numpy().tobytes()).hexdigest()}), flush=True)

    run("greedy_stock", False, False)
    run("greedy_fast_cold", True, False)
    run("greedy_fast_warm", True, False)
    decoder.release()
    run("sample_fast_cold", True, True)
    run("sample_fast_warm", True, True)
    run("sample_intruder", True, True, seed=22)
    run("sample_fast_after_intruder", True, True)
    run("sample_stock", False, True)
    for first, second in [
        ("greedy_stock", "greedy_fast_cold"),
        ("greedy_fast_cold", "greedy_fast_warm"),
        ("sample_fast_cold", "sample_fast_warm"),
        ("sample_fast_warm", "sample_fast_after_intruder"),
        ("sample_stock", "sample_fast_warm"),
    ]:
        a, b = results[first], results[second]
        n = min(len(a), len(b))
        different = (a[:n] != b[:n]).any(dim=1).nonzero()
        print(json.dumps({"compare": [first, second], "equal": torch.equal(a, b),
                          "first_different_frame": int(different[0]) if len(different) else None}), flush=True)
    decoder.uninstall()


if __name__ == "__main__":
    main()
