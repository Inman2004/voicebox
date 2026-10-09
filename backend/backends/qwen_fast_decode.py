"""
CUDA-graph decoder for the Qwen3-TTS talker.

Why this exists
---------------
Each 12 Hz audio frame of Qwen3-TTS runs one 28-layer talker step plus a
nested 15-step ``code_predictor.generate()``. In eager PyTorch that is ~8,000
tiny CUDA kernel launches per frame; on Windows (WDDM) every launch costs
~17 µs of CPU time, so generation is bound by one Python thread and the GPU
idles more than half the time (measured: 2.3 frames/s ≈ 0.18× realtime on an
RTX 3050 Laptop with the whole model resident in VRAM).

What it does
------------
The production path keeps upstream talker.generate, including its dynamic
cache, attention masks, logits processors and stopping behavior. Only the
fixed length code predictor is captured in a CUDA graph.

The earlier whole frame graph changed attention shapes and kernels, which
changed Ryan's codes even with greedy decoding. That path is retained only
as _legacy_fast for diagnostic comparisons. It is not selected by the app.

Anything outside that envelope (batch > 1, padded prompts, non-CUDA, an
unexpected kwarg, a capture failure) falls back to the original
``generate``; ``last_run`` records which path ran and why.
"""

from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass, field
from types import SimpleNamespace
from typing import Any, Optional

import torch

logger = logging.getLogger(__name__)

# Initial talker KV capacity beyond the prompt; doubled (and the graph
# re-captured) if a generation runs longer.
_INITIAL_FRAMES = 1024
_KNOWN_KWARGS = {
    "inputs_embeds", "attention_mask", "trailing_text_hidden", "tts_pad_embed",
    "max_new_tokens", "min_new_tokens", "do_sample", "top_k", "top_p", "temperature",
    "subtalker_dosample", "subtalker_top_k", "subtalker_top_p", "subtalker_temperature",
    "eos_token_id", "repetition_penalty", "suppress_tokens",
    "output_hidden_states", "return_dict_in_generate",
}


@dataclass
class DecodeRun:
    """What the last generate() call actually did (for diagnostics)."""

    path: str = "none"  # "cuda_graph" | "standard"
    reason: Optional[str] = None
    frames: int = 0
    prefill_s: float = 0.0
    capture_s: float = 0.0
    decode_s: float = 0.0
    extra: dict = field(default_factory=dict)

    @property
    def frames_per_s(self) -> Optional[float]:
        return self.frames / self.decode_s if self.decode_s > 0 else None


class _StaticKV:
    """Fixed-size KV cache with the ``update()`` API the decoder layers call."""

    def __init__(self, n_layers: int, kv_heads: int, head_dim: int, length: int, dtype, device):
        shape = (1, kv_heads, length, head_dim)
        self.k = [torch.zeros(shape, dtype=dtype, device=device) for _ in range(n_layers)]
        self.v = [torch.zeros(shape, dtype=dtype, device=device) for _ in range(n_layers)]
        self.length = length

    def update(self, key_states, value_states, layer_idx, cache_kwargs=None):
        pos = cache_kwargs["cache_position"]
        self.k[layer_idx].index_copy_(2, pos, key_states)
        self.v[layer_idx].index_copy_(2, pos, value_states)
        return self.k[layer_idx], self.v[layer_idx]

    def nbytes(self) -> int:
        return sum(t.numel() * t.element_size() for t in self.k + self.v)


@dataclass(frozen=True)
class _Sampling:
    do_sample: bool
    top_k: int
    top_p: float
    temperature: float


def _warp(scores: torch.Tensor, s: _Sampling) -> torch.Tensor:
    """HF TemperatureLogitsWarper → TopKLogitsWarper → TopPLogitsWarper."""
    if not s.do_sample:
        return scores
    if s.temperature != 1.0:
        scores = scores / s.temperature
    if s.top_k and s.top_k > 0:
        k = min(s.top_k, scores.size(-1))
        kth = torch.topk(scores, k)[0][..., -1, None]
        scores = scores.masked_fill(scores < kth, float("-inf"))
    if s.top_p < 1.0:
        sorted_logits, sorted_idx = torch.sort(scores, descending=False)
        cum = sorted_logits.softmax(dim=-1).cumsum(dim=-1)
        remove = cum <= (1 - s.top_p)
        remove[..., -1:] = False
        scores = scores.masked_fill(remove.scatter(1, sorted_idx, remove), float("-inf"))
    return scores


def _pick(scores: torch.Tensor, s: _Sampling) -> torch.Tensor:
    if s.do_sample:
        return torch.multinomial(scores.softmax(dim=-1), num_samples=1)
    return scores.argmax(dim=-1, keepdim=True)


class FastTalkerDecoder:
    """Per-model CUDA-graph replacement for ``talker.generate``."""

    def __init__(self, tts_model):
        self.model = tts_model  # Qwen3TTSForConditionalGeneration
        self.talker = tts_model.talker
        self.cp = self.talker.code_predictor
        self._orig_generate = None
        self._lock = threading.Lock()
        self.enabled = True
        self.last_run = DecodeRun()
        # Graph state, (re)built lazily.
        self._graph: Optional[torch.cuda.CUDAGraph] = None
        self._graph_key: Optional[tuple] = None
        self._graph_failed: Optional[str] = None
        self._static: dict[str, Any] = {}
        self._trailing_src: Optional[tuple[torch.Tensor, torch.Tensor]] = None
        self._predictor_decoder = None

    # ── install / uninstall ────────────────────────────────────────────

    @classmethod
    def install(cls, tts_model) -> "FastTalkerDecoder":
        dec = cls(tts_model)
        dec._orig_generate = tts_model.talker.generate
        tts_model.talker.generate = dec.generate  # instance attribute shadows the method
        tts_model._voicebox_fast_decoder = dec
        return dec

    def uninstall(self) -> None:
        """Restore ``talker.generate`` and break the model ↔ decoder reference cycle,
        so unloading the model frees its VRAM without waiting for the garbage collector."""
        if self._orig_generate is not None:
            try:
                del self.talker.generate
            except AttributeError:
                pass
            self._orig_generate = None
        if getattr(self.model, "_voicebox_fast_decoder", None) is self:
            del self.model._voicebox_fast_decoder
        self.release()
        self._trailing_src = None
        self.model = self.talker = self.cp = None

    def release(self) -> None:
        """Drop the graph and static buffers (frees their VRAM)."""
        if self._predictor_decoder is not None:
            self._predictor_decoder.release()
            self._predictor_decoder = None
        self._graph = None
        self._graph_key = None
        self._static = {}

    def static_bytes(self) -> int:
        if self._predictor_decoder is not None and self._predictor_decoder.cache is not None:
            return self._predictor_decoder.cache.nbytes()
        cache = self._static.get("t_cache")
        return cache.nbytes() if cache is not None else 0

    # ── entry point ────────────────────────────────────────────────────

    def generate(self, **kwargs):
        reason = self._unsupported(kwargs)
        if reason is None and self._graph_failed:
            reason = f"graph capture failed earlier: {self._graph_failed}"
        if reason is not None:
            return self._standard(kwargs, reason)
        with self._lock:
            try:
                return self._fast(kwargs)
            except torch.cuda.OutOfMemoryError:
                self.release()
                raise
            except Exception as e:  # capture/replay problem → never lose the request
                logger.exception("CUDA-graph talker decode failed; using standard decode")
                self._graph_failed = f"{type(e).__name__}: {e}"
                self.release()
                return self._standard(kwargs, self._graph_failed)

    def _unsupported(self, kw: dict) -> Optional[str]:
        if not self.enabled:
            return "disabled"
        if not torch.cuda.is_available() or self.talker.device.type != "cuda":
            return "model not on CUDA"
        extra = set(kw) - _KNOWN_KWARGS
        if extra:
            return f"unsupported arguments: {sorted(extra)}"
        emb = kw.get("inputs_embeds")
        if emb is None or emb.shape[0] != 1:
            return "batch size != 1"
        mask = kw.get("attention_mask")
        if mask is not None and not bool(mask.all()):
            return "padded prompt"
        return None

    def _standard(self, kwargs: dict, reason: str):
        t = time.perf_counter()
        out = self._orig_generate(**kwargs)
        self.last_run = DecodeRun(path="standard", reason=reason, decode_s=time.perf_counter() - t,
                                  frames=len(out.hidden_states) - 1 if getattr(out, "hidden_states", None) else 0)
        return out

    # ── fast path ──────────────────────────────────────────────────────

    def _fast(self, kw: dict):
        from .qwen_fast_predictor import FastCodePredictor

        if self._predictor_decoder is None:
            self._predictor_decoder = FastCodePredictor(self.cp)
        predictor = self._predictor_decoder
        capture_before, calls_before = predictor.capture_seconds, predictor.calls
        original = self.cp.generate
        started = time.perf_counter()
        self.cp.generate = predictor.generate
        try:
            output = self._orig_generate(**kw)
        finally:
            # Do not leave the predictor patched on cancellation or exceptions.
            self.cp.generate = original
        torch.cuda.synchronize(self.talker.device)
        frames = len(output.hidden_states) - 1 if getattr(output, "hidden_states", None) else 0
        accelerated = predictor.calls - calls_before
        self.last_run = DecodeRun(
            path="cuda_graph" if accelerated else "standard",
            reason=None if accelerated else "no compatible predictor calls",
            frames=frames, decode_s=time.perf_counter() - started,
            capture_s=predictor.capture_seconds - capture_before,
            extra={"strategy": "stock_talker_graph_predictor", "predictor_calls": accelerated},
        )
        return output

    def _legacy_fast(self, kw: dict):
        """Retired whole frame graph, used only by the diagnostic harness."""
        talker, cp = self.talker, self.cp
        tcfg = talker.config
        device = talker.device
        dtype = talker.codec_head.weight.dtype
        emb = kw["inputs_embeds"]
        L = emb.shape[1]
        max_new = int(kw.get("max_new_tokens") or 4096)
        min_new = int(kw.get("min_new_tokens") or 0)
        eos = int(kw["eos_token_id"])
        penalty = float(kw.get("repetition_penalty") or 1.0)
        main = _Sampling(bool(kw.get("do_sample", True)), int(kw.get("top_k") or 0),
                         float(kw.get("top_p") if kw.get("top_p") is not None else 1.0),
                         float(kw.get("temperature") or 1.0))
        sub = _Sampling(bool(kw.get("subtalker_dosample", True)), int(kw.get("subtalker_top_k") or 0),
                        float(kw.get("subtalker_top_p") if kw.get("subtalker_top_p") is not None else 1.0),
                        float(kw.get("subtalker_temperature") or 1.0))
        suppress = kw.get("suppress_tokens") or []
        trailing = kw["trailing_text_hidden"]  # [1, T, H]
        pad = kw["tts_pad_embed"]  # [1, 1, H]

        run = DecodeRun(path="cuda_graph")
        t0 = time.perf_counter()

        # Capacity: prompt + frames, grown by re-capture if exceeded.
        frames_cap = min(max_new, _INITIAL_FRAMES)
        self._ensure_graph(L, frames_cap, dtype, device, (main, sub, penalty, min_new, eos, tuple(suppress)), run)
        S = self._static
        # A reused graph may be larger than requested; its usable frame count is
        # bounded by both its trailing buffer and the cache left after this prompt.
        frames_cap = min(S["frames_cap"], S["t_cache"].length - L - 1)

        # ── reset per-generation state ──
        S["t_mask"].zero_()
        S["t_mask"][..., :L] = True
        S["presence"].zero_()
        S["n_generated"].zero_()
        S["step"].zero_()
        self._trailing_src = (trailing, pad)
        self._fill_trailing(S)

        # ── prefill (eager) ──
        ones = torch.ones((1, L), dtype=torch.long, device=device)
        position_ids, rope_deltas = talker.get_rope_index(ones)
        rope_deltas = rope_deltas - (1 - ones).sum(dim=-1).unsqueeze(1)
        causal = torch.ones((L, L), dtype=torch.bool, device=device).tril()
        pmask = torch.zeros((1, 1, L, S["t_cache"].length), dtype=torch.bool, device=device)
        pmask[0, 0, :, :L] = causal
        cache_pos = torch.arange(L, device=device)
        h = self._talker_layers(emb.to(dtype), position_ids, pmask, cache_pos)
        prefill_hidden = h
        logits = talker.codec_head(h[:, -1:, :])[:, -1, :].float()
        tok = self._sample_main(logits, S, main, penalty, min_new, eos)
        S["tok"].copy_(tok)
        S["past_hidden"].copy_(h[:, -1:, :])
        S["rope_delta"].copy_(rope_deltas.reshape(()).to(torch.long))
        S["t_cache_pos"].fill_(L)
        torch.cuda.synchronize()
        run.prefill_s = time.perf_counter() - t0

        hidden_states: list = [((prefill_hidden,), None)]
        codes_out: list[torch.Tensor] = []
        hidden_out: list[torch.Tensor] = []
        n_tokens = 1  # token_0 sampled
        stopped = int(tok.item()) == eos
        t_dec = time.perf_counter()
        frames_in_graph = 0
        while not stopped and n_tokens < max_new:
            if frames_in_graph >= frames_cap:
                frames_cap *= 2
                self._grow(L, frames_cap, dtype, device, (main, sub, penalty, min_new, eos, tuple(suppress)), run)
                frames_in_graph = frames_cap // 2
                S = self._static  # the new graph reads and writes the new buffers
            self._graph.replay()
            frames_in_graph += 1
            codes_out.append(S["codes"].clone())
            hidden_out.append(S["hidden"].clone())
            n_tokens += 1
            stopped = int(S["tok"].item()) == eos
        torch.cuda.synchronize()
        run.decode_s = time.perf_counter() - t_dec
        run.frames = len(codes_out)
        for c, hdn in zip(codes_out, hidden_out):
            hidden_states.append(((hdn,), c))
        self.last_run = run
        return SimpleNamespace(hidden_states=hidden_states, sequences=None)

    def _fill_trailing(self, S) -> None:
        """Per-frame text conditioning: the text hiddens, then the pad embedding."""
        trailing, pad = self._trailing_src
        buf = S["trailing"]
        n = min(trailing.shape[1], buf.shape[1])
        buf[:, :n].copy_(trailing[:, :n])
        if n < buf.shape[1]:
            buf[:, n:].copy_(pad.expand(1, buf.shape[1] - n, -1))

    # ── building blocks (used both eagerly and inside the graph) ──────

    def _talker_layers(self, x, position_ids3, mask, cache_position):
        m = self.talker.model
        pe = m.rotary_emb(x, position_ids3)
        h = x
        for layer in m.layers:
            h = layer(h, attention_mask=mask, position_ids=position_ids3[0], past_key_values=self._static["t_cache"],
                      use_cache=True, cache_position=cache_position, position_embeddings=pe)[0]
        return m.norm(h)

    def _sample_main(self, logits, S, s: _Sampling, penalty, min_new, eos):
        """HF processors for the talker: repetition penalty, min_new_tokens, suppress, warpers."""
        if penalty != 1.0:
            pen = torch.where(logits < 0, logits * penalty, logits / penalty)
            logits = torch.where(S["presence"], pen, logits)
        if min_new > 0:
            block = (S["n_generated"] < min_new) & S["eos_onehot"]
            logits = logits.masked_fill(block, float("-inf"))
        logits = logits.masked_fill(S["suppress"], float("-inf"))
        tok = _pick(_warp(logits, s), s)  # [1, 1]
        S["presence"].scatter_(1, tok, True)
        S["n_generated"].add_(1)
        return tok

    def _frame(self, S, main, sub, penalty, min_new, eos):
        """One audio frame: predictor for the previous token, talker step, next token."""
        talker, cp = self.talker, self.cp
        groups = talker.config.num_code_groups
        tok = S["tok"]  # [1, 1] token_{n-1}
        last_id_hidden = talker.get_input_embeddings()(tok)  # [1, 1, H]

        # Code predictor: prefill of [past_hidden, last_id_hidden] + 14 steps.
        x = cp.small_to_mtp_projection(torch.cat((S["past_hidden"], last_id_hidden), dim=1))
        pos = S["p_pos"][:, :2]
        h = self._pred_layers(x, pos, S["p_masks"][0], S["p_cache_pos"][:2])
        ptok = _pick(_warp(cp.lm_head[0](h[:, -1:, :])[:, -1, :].float(), sub), sub)
        sub_tokens = [ptok]
        embeds = cp.get_input_embeddings()
        for j in range(1, groups - 1):
            e = cp.small_to_mtp_projection(embeds[j - 1](ptok))
            p = S["p_cache_pos"][1 + j:2 + j]
            h = self._pred_layers(e, S["p_pos"][:, 1 + j:2 + j], S["p_masks"][j], p)
            ptok = _pick(_warp(cp.lm_head[j](h)[:, -1, :].float(), sub), sub)
            sub_tokens.append(ptok)
        seq = torch.cat(sub_tokens, dim=-1)  # [1, 15]
        S["codes"].copy_(torch.cat((tok, seq), dim=-1))

        # Next talker input: sum of all 16 codebook embeddings + text conditioning.
        codec_hiddens = [last_id_hidden] + [embeds[i](seq[..., i:i + 1]) for i in range(groups - 1)]
        inp = torch.cat(codec_hiddens, dim=1).sum(1, keepdim=True)
        inp = inp + S["trailing"].index_select(1, S["step"])

        # Talker step at position = cache_pos + rope_delta.
        cpos = S["t_cache_pos"]
        S["t_mask"].index_fill_(3, cpos, True)
        pid = (cpos + S["rope_delta"]).view(1, 1, 1).expand(3, 1, 1)
        h = self._talker_layers(inp, pid, S["t_mask"], cpos)
        S["hidden"].copy_(h)
        S["past_hidden"].copy_(h[:, -1:, :])
        logits = talker.codec_head(h)[:, -1, :].float()
        S["tok"].copy_(self._sample_main(logits, S, main, penalty, min_new, eos))
        S["t_cache_pos"].add_(1)
        S["step"].add_(1)

    def _pred_layers(self, x, pos, mask, cache_position):
        m = self.cp.model
        pe = m.rotary_emb(x, pos)
        h = x
        for layer in m.layers[: m.config.num_hidden_layers]:
            h = layer(h, attention_mask=mask, position_ids=pos, past_key_values=self._static["p_cache"],
                      use_cache=True, cache_position=cache_position, position_embeddings=pe)[0]
        return m.norm(h)

    # ── graph management ───────────────────────────────────────────────

    def _alloc(self, L: int, frames_cap: int, dtype, device, suppress: tuple, eos: int):
        tc, pc = self.talker.config, self.cp.config
        H = tc.hidden_size
        t_len = L + frames_cap + 1
        groups = tc.num_code_groups
        p_len = groups  # 2 prefill + 14 steps
        V = tc.vocab_size
        S: dict[str, Any] = {
            "t_cache": _StaticKV(tc.num_hidden_layers, tc.num_key_value_heads,
                                 getattr(tc, "head_dim", H // tc.num_attention_heads), t_len, dtype, device),
            "p_cache": _StaticKV(pc.num_hidden_layers, pc.num_key_value_heads,
                                 getattr(pc, "head_dim", pc.hidden_size // pc.num_attention_heads), p_len, dtype, device),
            "t_mask": torch.zeros((1, 1, 1, t_len), dtype=torch.bool, device=device),
            "t_cache_pos": torch.zeros((1,), dtype=torch.long, device=device),
            "rope_delta": torch.zeros((), dtype=torch.long, device=device),
            "step": torch.zeros((1,), dtype=torch.long, device=device),
            "trailing": torch.zeros((1, frames_cap + 1, H), dtype=dtype, device=device),
            "tok": torch.zeros((1, 1), dtype=torch.long, device=device),
            "past_hidden": torch.zeros((1, 1, H), dtype=dtype, device=device),
            "hidden": torch.zeros((1, 1, H), dtype=dtype, device=device),
            "codes": torch.zeros((1, groups), dtype=torch.long, device=device),
            "presence": torch.zeros((1, V), dtype=torch.bool, device=device),
            "n_generated": torch.zeros((), dtype=torch.long, device=device),
            "p_pos": torch.arange(p_len, device=device).unsqueeze(0),
            "p_cache_pos": torch.arange(p_len, device=device),
            "frames_cap": frames_cap,
        }
        eos_onehot = torch.zeros((1, V), dtype=torch.bool, device=device)
        eos_onehot[0, eos] = True
        S["eos_onehot"] = eos_onehot
        sup = torch.zeros((1, V), dtype=torch.bool, device=device)
        if suppress:
            sup[0, torch.tensor(list(suppress), device=device)] = True
        S["suppress"] = sup
        # Predictor masks: [0] prefill (2 queries, causal), [j] step j (1 query at pos 1+j).
        masks = []
        m0 = torch.zeros((1, 1, 2, p_len), dtype=torch.bool, device=device)
        m0[0, 0, 0, 0] = True
        m0[0, 0, 1, :2] = True
        masks.append(m0)
        for j in range(1, groups - 1):
            mj = torch.zeros((1, 1, 1, p_len), dtype=torch.bool, device=device)
            mj[..., : 2 + j] = True
            masks.append(mj)
        S["p_masks"] = masks
        return S

    def _ensure_graph(self, L, frames_cap, dtype, device, cfg, run: DecodeRun):
        main, sub, penalty, min_new, eos, suppress = cfg
        # Prompt length only affects the capacity, so reuse a graph whose
        # cache is big enough for this prompt.
        key = (cfg, dtype)
        cache = self._static.get("t_cache")
        if (
            self._graph is not None
            and self._graph_key == key
            and cache is not None
            and cache.length >= L + frames_cap + 1
            and self._static["frames_cap"] >= frames_cap
        ):
            return
        self._capture(L, frames_cap, dtype, device, cfg, run)

    def _grow(self, L, frames_cap, dtype, device, cfg, run: DecodeRun):
        """Double capacity mid-generation: copy state into bigger buffers and re-capture."""
        old = self._static
        self._capture(L, frames_cap, dtype, device, cfg, run, keep_state_from=old)

    def _capture(self, L, frames_cap, dtype, device, cfg, run: DecodeRun, keep_state_from=None):
        main, sub, penalty, min_new, eos, suppress = cfg
        t = time.perf_counter()
        self._graph = None
        S = self._alloc(L, frames_cap, dtype, device, suppress, eos)
        if keep_state_from is not None:
            old = keep_state_from
            n = old["t_cache"].length
            for dst, src in zip(S["t_cache"].k + S["t_cache"].v, old["t_cache"].k + old["t_cache"].v):
                dst[:, :, :n].copy_(src)
            S["t_mask"][..., :n].copy_(old["t_mask"])
            self._fill_trailing(S)
            for k in ("t_cache_pos", "rope_delta", "step", "tok", "past_hidden", "presence", "n_generated"):
                S[k].copy_(old[k])
        self._static = S

        # Snapshot state the warm-up/capture passes mutate, then restore it.
        mutable = ("t_mask", "t_cache_pos", "step", "tok", "past_hidden", "presence", "n_generated", "hidden", "codes")
        saved = {k: S[k].clone() for k in mutable}
        saved_t = [x.clone() for x in S["t_cache"].k + S["t_cache"].v] if keep_state_from is not None else None
        rng = torch.cuda.get_rng_state()

        stream = torch.cuda.Stream()
        stream.wait_stream(torch.cuda.current_stream())
        with torch.cuda.stream(stream):
            for _ in range(2):
                self._frame(S, main, sub, penalty, min_new, eos)
        torch.cuda.current_stream().wait_stream(stream)
        for k in mutable:
            S[k].copy_(saved[k])

        graph = torch.cuda.CUDAGraph()
        with torch.cuda.graph(graph):
            self._frame(S, main, sub, penalty, min_new, eos)
        for k in mutable:
            S[k].copy_(saved[k])
        if saved_t is not None:
            for dst, src in zip(S["t_cache"].k + S["t_cache"].v, saved_t):
                dst.copy_(src)
        torch.cuda.set_rng_state(rng)
        self._graph = graph
        self._graph_key = (cfg, dtype)
        torch.cuda.synchronize()
        run.capture_s += time.perf_counter() - t
        run.extra["kv_capacity"] = S["t_cache"].length
        logger.info("Captured Qwen talker CUDA graph (capacity %d positions) in %.2fs",
                    S["t_cache"].length, time.perf_counter() - t)


def get_decoder(tts_model) -> Optional[FastTalkerDecoder]:
    return getattr(tts_model, "_voicebox_fast_decoder", None)
