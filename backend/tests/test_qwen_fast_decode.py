"""FastTalkerDecoder must fall back to the stock talker.generate when it can't use CUDA graphs."""

from types import SimpleNamespace

import pytest

torch = pytest.importorskip("torch")

from backend.backends.qwen_fast_decode import FastTalkerDecoder  # noqa: E402


class _Talker:
    def __init__(self, device="cpu"):
        self.device = torch.device(device)
        self.code_predictor = object()
        self.calls = 0

    def generate(self, **kwargs):
        self.calls += 1
        return SimpleNamespace(hidden_states=[((None,), None), ((None,), "codes")])


def _install(device="cpu"):
    model = SimpleNamespace(talker=_Talker(device))
    return model, FastTalkerDecoder.install(model)


def _kwargs(batch=1):
    return {"inputs_embeds": torch.zeros(batch, 4, 8), "attention_mask": torch.ones(batch, 4, dtype=torch.long)}


def test_install_shadows_generate_and_uninstall_restores():
    model, dec = _install()
    assert model.talker.generate == dec.generate
    dec.uninstall()
    assert model.talker.generate.__func__ is _Talker.generate


def test_uninstall_breaks_the_model_decoder_cycle():
    """Unloading must free the model at once, not whenever the GC finds the cycle."""
    import gc
    import weakref

    model, dec = _install()
    ref = weakref.ref(model.talker)
    dec.uninstall()
    assert not hasattr(model, "_voicebox_fast_decoder")
    gc.disable()
    try:
        del model
        assert ref() is None
    finally:
        gc.enable()


def test_falls_back_when_model_not_on_cuda():
    model, dec = _install("cpu")
    out = model.talker.generate(**_kwargs())
    assert model.talker.calls == 1
    assert dec.last_run.path == "standard"
    assert out.hidden_states[-1][1] == "codes"


@pytest.mark.parametrize(
    "kwargs, reason",
    [
        ({"unexpected_arg": 1}, "unsupported arguments"),
        ({"batch": 2}, "batch size"),
        ({"padded": True}, "padded prompt"),
    ],
)
def test_unsupported_requests_use_standard_decode(monkeypatch, kwargs, reason):
    monkeypatch.setattr(torch.cuda, "is_available", lambda: True)
    model, dec = _install("cpu")
    model.talker.device = SimpleNamespace(type="cuda")
    request = _kwargs(batch=kwargs.pop("batch", 1))
    if kwargs.pop("padded", False):
        request["attention_mask"][0, 0] = 0
    request.update(kwargs)
    model.talker.generate(**request)
    assert dec.last_run.path == "standard"
    assert reason in dec.last_run.reason


def test_disabled_decoder_uses_standard_decode():
    model, dec = _install("cpu")
    dec.enabled = False
    model.talker.generate(**_kwargs())
    assert dec.last_run.reason == "disabled"


@pytest.mark.parametrize("fails", [False, True])
def test_fast_path_keeps_stock_talker_and_restores_predictor(monkeypatch, fails):
    from backend.backends import qwen_fast_predictor

    model, dec = _install()
    original_predictor = lambda **kwargs: None
    dec.cp = SimpleNamespace(generate=original_predictor)
    model.talker.code_predictor = dec.cp

    class Predictor:
        def __init__(self, cp):
            self.capture_seconds = 0
            self.calls = 0

        def generate(self, **kwargs):
            self.calls += 1

    monkeypatch.setattr(qwen_fast_predictor, "FastCodePredictor", Predictor)
    monkeypatch.setattr(torch.cuda, "synchronize", lambda *args: None)

    def stock(**kwargs):
        assert dec.cp.generate != original_predictor
        dec.cp.generate()
        if fails:
            raise RuntimeError("diagnostic failure")
        return SimpleNamespace(hidden_states=[((None,), None), ((None,), "stock codes")])

    dec._orig_generate = stock
    dec._legacy_fast = lambda kw: pytest.fail("retired whole frame decoder must not run")
    if fails:
        with pytest.raises(RuntimeError, match="diagnostic failure"):
            dec._fast({})
    else:
        result = dec._fast({})
        assert result.hidden_states[-1][1] == "stock codes"
        assert dec.last_run.extra["strategy"] == "stock_talker_graph_predictor"
        assert dec.last_run.path == "cuda_graph"
    assert dec.cp.generate is original_predictor


def test_predictor_cache_returns_only_the_live_prefix():
    from backend.backends.qwen_fast_predictor import _LivePrefixKV

    cache = _LivePrefixKV(1, 1, 2, 16, torch.float32, "cpu")
    cache.active_length = 2
    values = torch.ones(1, 1, 2, 2)
    key, value = cache.update(values, values, 0, {"cache_position": torch.arange(2)})
    assert key.shape == value.shape == (1, 1, 2, 2)
    assert torch.equal(key, values)
    assert cache.k[0].shape[2] == 16
