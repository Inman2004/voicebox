"""CUDA graph for the fixed length code predictor, without replacing the talker.

The talker keeps upstream dynamic cache shapes, masks and sampling. Predictor
attention sees only its live cache prefix, just like upstream DynamicCache.
"""
import time
from types import SimpleNamespace

import torch

from .qwen_fast_decode import _Sampling, _StaticKV, _pick, _warp


class _LivePrefixKV(_StaticKV):
    active_length = 0

    def update(self, key_states, value_states, layer_idx, cache_kwargs=None):
        key, value = super().update(key_states, value_states, layer_idx, cache_kwargs)
        return key[:, :, :self.active_length], value[:, :, :self.active_length]


class FastCodePredictor:
    def __init__(self, predictor):
        self.predictor = predictor
        self.original = predictor.generate
        self.graph = None
        self.key = None
        self.capture_seconds = 0.0
        self.calls = 0

    def release(self):
        self.graph = None
        self.key = None
        self.input = None
        self.codes = None
        self.cache = None

    def generate(self, **kwargs):
        allowed = {"inputs_embeds", "max_new_tokens", "do_sample", "top_p", "top_k",
                   "temperature", "output_hidden_states", "return_dict_in_generate"}
        x = kwargs.get("inputs_embeds")
        groups = len(self.predictor.lm_head)
        if (set(kwargs) - allowed or x is None or x.shape[:2] != (1, 2)
                or x.device.type != "cuda" or kwargs.get("max_new_tokens") != groups):
            return self.original(**kwargs)
        sampling = _Sampling(bool(kwargs.get("do_sample", True)),
                             int(kwargs.get("top_k") or 0),
                             float(kwargs.get("top_p", 1.0)),
                             float(kwargs.get("temperature", 1.0)))
        key = (sampling, tuple(x.shape), x.dtype, x.device)
        if self.graph is None or self.key != key:
            self._capture(x, sampling)
            self.key = key
        self.input.copy_(x)
        self.graph.replay()
        self.calls += 1
        # The upstream talker consumes sequences, not predictor hidden states.
        return SimpleNamespace(sequences=self.codes.clone(), hidden_states=None)

    def _layers(self, x, start, length):
        model = self.predictor.model
        self.cache.active_length = length
        positions = torch.arange(start, length, device=x.device)
        pos = positions.unsqueeze(0)
        rotary = model.rotary_emb(x, pos)
        for layer in model.layers[:model.config.num_hidden_layers]:
            x = layer(x, attention_mask=None, position_ids=pos,
                      past_key_values=self.cache, use_cache=True,
                      cache_position=positions, position_embeddings=rotary)[0]
        return model.norm(x)

    def _frame(self, sampling):
        predictor = self.predictor
        x = predictor.small_to_mtp_projection(self.input)
        hidden = self._layers(x, 0, 2)
        # Match upstream's full prefill head shape before selecting last logits.
        logits = predictor.lm_head[0](hidden)[:, -1, :].clone().float()
        token = _pick(_warp(logits, sampling), sampling)
        codes = [token]
        for j in range(1, len(predictor.lm_head)):
            x = predictor.small_to_mtp_projection(predictor.get_input_embeddings()[j - 1](token))
            hidden = self._layers(x, j + 1, j + 2)
            logits = predictor.lm_head[j](hidden)[:, -1, :].clone().float()
            token = _pick(_warp(logits, sampling), sampling)
            codes.append(token)
        self.codes.copy_(torch.cat(codes, dim=-1))

    def _capture(self, x, sampling):
        self.release()
        started = time.perf_counter()
        config = self.predictor.config
        self.input = x.clone()
        self.codes = torch.zeros((1, len(self.predictor.lm_head)), dtype=torch.long, device=x.device)
        self.cache = _LivePrefixKV(
            config.num_hidden_layers, config.num_key_value_heads,
            getattr(config, "head_dim", config.hidden_size // config.num_attention_heads),
            len(self.predictor.lm_head) + 1, x.dtype, x.device,
        )
        rng = torch.cuda.get_rng_state(x.device)
        try:
            stream = torch.cuda.Stream(device=x.device)
            stream.wait_stream(torch.cuda.current_stream(x.device))
            with torch.cuda.stream(stream):
                for _ in range(2):
                    self._frame(sampling)
            torch.cuda.current_stream(x.device).wait_stream(stream)
            graph = torch.cuda.CUDAGraph()
            with torch.cuda.graph(graph, stream=stream):
                self._frame(sampling)
            self.graph = graph
        finally:
            torch.cuda.set_rng_state(rng, x.device)
        self.capture_seconds += time.perf_counter() - started
