"""Opt-in Qwen SDPA adapter for the measured Windows GQA math fallback.

Transformers 4.57 enables GQA even on torch builds without Flash Attention.
Explicitly expanding KV heads allows efficient SDPA kernels on those builds.
Weights, cache layout, sampling, masks and scaling are unchanged. Keep this
version gated: upstream attention signatures and mask handling can change.
"""
from copy import copy
from importlib.metadata import version

import torch

NAME = "voicebox_qwen_sdpa_repeat_kv"


def attention_forward(module, query, key, value, attention_mask, dropout=0.0,
                      scaling=None, is_causal=None, **kwargs):
    from transformers.integrations.sdpa_attention import repeat_kv

    groups = getattr(module, "num_key_value_groups", 1)
    key, value = repeat_kv(key, groups), repeat_kv(value, groups)
    if attention_mask is not None and attention_mask.ndim == 4:
        attention_mask = attention_mask[:, :, :, :key.shape[-2]]
    if is_causal is None:
        is_causal = query.shape[2] > 1 and attention_mask is None and getattr(module, "is_causal", True)
    output = torch.nn.functional.scaled_dot_product_attention(
        query, key, value, attn_mask=attention_mask, dropout_p=dropout,
        scale=scaling, is_causal=is_causal,
    )
    return output.transpose(1, 2).contiguous(), None


def install(wrapper):
    from transformers.modeling_utils import ALL_ATTENTION_FUNCTIONS

    supported = (version("qwen-tts") == "0.1.1" and version("transformers") == "4.57.3"
                 and torch.__version__.split("+")[0] == "2.11.0")
    if not supported:
        raise ValueError("Optimized Qwen SDPA is validated only for qwen-tts 0.1.1, transformers 4.57.3 and torch 2.11.0. Disable it for this runtime.")
    ALL_ATTENTION_FUNCTIONS.register(NAME, attention_forward)
    count = 0
    for module in wrapper.model.talker.modules():
        if type(module).__name__ in {"Qwen3TTSTalkerAttention", "Qwen3TTSAttention"}:
            # Copy just the attention layer's config. The parent keeps "sdpa"
            # so Transformers continues constructing its normal causal masks.
            module.config = copy(module.config)
            module.config._attn_implementation = NAME
            count += 1
    if not count:
        raise ValueError("No compatible Qwen attention modules found; optimization not applied.")
    return count
