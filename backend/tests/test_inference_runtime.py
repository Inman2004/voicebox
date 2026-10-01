"""Runtime truth, option snapshots, additive migrations and cancellation."""
import asyncio
import threading
from types import SimpleNamespace

import pytest
import torch
from sqlalchemy import create_engine, inspect, text

from backend.services import inference_runtime as runtime
from backend.models import QwenExecutionOptions


@pytest.fixture(autouse=True)
def isolate_runtime(monkeypatch):
    monkeypatch.setattr(runtime, "_latest", None)
    monkeypatch.setattr(runtime, "_jobs", {})
    monkeypatch.setattr(runtime, "cuda_memory", lambda *a: None)
    token = runtime.OPTIONS.set(None)
    job = runtime.JOB_ID.set(None)
    yield
    runtime.OPTIONS.reset(token)
    runtime.JOB_ID.reset(job)


def test_snapshot_at_submission(monkeypatch):
    defaults = {"mode": "cuda_only", "precision": "bf16"}
    monkeypatch.setattr(runtime, "saved_options", lambda: dict(defaults))

    @runtime.qwen_job
    async def job(*, engine, model_size):
        return runtime.OPTIONS.get()

    pending = job(engine="qwen_custom_voice", model_size="0.6B")
    defaults["mode"] = "cpu"
    assert asyncio.run(pending) == {"mode": "cuda_only", "precision": "bf16", "model_size": "0.6B"}
    assert runtime.OPTIONS.get() is None


def test_cancel_waits_for_worker_even_if_cancelled_twice():
    async def scenario():
        started, finish, exited = threading.Event(), threading.Event(), threading.Event()
        def work():
            started.set()
            finish.wait(3)
            exited.set()
        task = asyncio.create_task(runtime.finish_thread(work))
        while not started.is_set():
            await asyncio.sleep(0.005)
        task.cancel()
        await asyncio.sleep(0.01)
        task.cancel()
        await asyncio.sleep(0.01)
        assert not task.done()
        finish.set()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert exited.is_set()
    asyncio.run(scenario())


def test_shared_storage_counted_once_and_codec_included():
    module = torch.nn.Module()
    module.talker = torch.nn.Module()
    module.talker.model = torch.nn.Linear(2, 2, bias=False)
    module.talker.codec_head = module.talker.model
    module.speech_tokenizer = SimpleNamespace(model=torch.nn.Sequential(torch.nn.Linear(2, 2, bias=False)))
    rows = runtime.inspect_components(SimpleNamespace(model=module))
    assert sum(r["storage_bytes"] for r in rows) == 32
    assert any(r["name"].startswith("speech_tokenizer") for r in rows)
    assert runtime.execution_state(rows, observed=True) == "unverified"
    assert runtime.execution_state(rows) == "cpu"


def test_mixed_requires_devices_not_cpu_usage():
    rows = [{"devices": ["cuda:0"], "executed": True}, {"devices": ["cpu"], "executed": False}]
    assert runtime.execution_state(rows, observed=True) == "cuda"
    rows[1]["executed"] = True
    assert runtime.execution_state(rows, observed=True) == "mixed"


def test_strict_hooks_reject_cpu():
    inner = torch.nn.Module()
    inner.talker = torch.nn.Sequential(torch.nn.Linear(2, 2))
    with pytest.raises(runtime.RuntimePlacementError), runtime.ObserveExecution(SimpleNamespace(model=inner), strict=True):
        inner.talker(torch.ones(1, 2))
    assert not inner.talker[0]._forward_pre_hooks


def test_strict_cuda_unavailable_never_loads(monkeypatch):
    from backend.backends.qwen_custom_voice_backend import QwenCustomVoiceBackend
    monkeypatch.setattr(torch.cuda, "is_available", lambda: False)
    backend = QwenCustomVoiceBackend()
    runtime.OPTIONS.set({"mode": "cuda_only", "precision": "auto"})
    with pytest.raises(RuntimeError, match="CUDA Only requires"):
        asyncio.run(backend.load_model_async("0.6B"))
    assert backend.model is None
    assert runtime.snapshot()["failure"]["code"] == "cuda_unavailable"


def test_unload_busy_does_not_block_event_loop(monkeypatch):
    from backend.backends.qwen_custom_voice_backend import QwenCustomVoiceBackend
    backend = QwenCustomVoiceBackend()
    ready, finish = threading.Event(), threading.Event()
    def hold():
        with backend._execution_guard:
            ready.set()
            finish.wait(2)
    thread = threading.Thread(target=hold)
    thread.start()
    ready.wait(2)
    try:
        with pytest.raises(runtime.RuntimeBusyError):
            backend.unload_model()
    finally:
        finish.set()
        thread.join()


def test_migration_is_additive_and_idempotent(tmp_path):
    from backend.database.migrations import run_migrations
    engine = create_engine(f"sqlite:///{tmp_path / 'old.db'}")
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE generation_settings (id INTEGER PRIMARY KEY)"))
        conn.execute(text("CREATE TABLE generations (id TEXT PRIMARY KEY, audio_path TEXT)"))
        conn.execute(text("INSERT INTO generations (id) VALUES ('existing')"))
    run_migrations(engine)
    run_migrations(engine)
    assert "diagnostics" in {c["name"] for c in inspect(engine).get_columns("generations")}
    assert "qwen_execution_json" in {c["name"] for c in inspect(engine).get_columns("generation_settings")}
    with engine.connect() as conn:
        assert conn.execute(text("SELECT diagnostics FROM generations WHERE id='existing'")).scalar() is None


def test_invalid_execution_options():
    with pytest.raises(ValueError):
        QwenExecutionOptions(mode="gpu_preferred")
    assert QwenExecutionOptions().mode == "auto"


@pytest.mark.parametrize("length,mask", [(1, False), (8, False), (8, True)])
def test_attention_adapter_matches_gqa_reference(length, mask):
    from backend.backends.qwen_attention import attention_forward
    torch.manual_seed(5)
    q, k, v = torch.randn(1, 4, length, 16), torch.randn(1, 2, 8, 16), torch.randn(1, 2, 8, 16)
    module = SimpleNamespace(num_key_value_groups=2, is_causal=True)
    attn_mask = torch.ones(length, 8, dtype=torch.bool).tril()[None, None] if mask else None
    expected = torch.nn.functional.scaled_dot_product_attention(q, k, v, attn_mask=attn_mask,
        is_causal=length > 1 and not mask, enable_gqa=True)
    actual, _ = attention_forward(module, q, k, v, attn_mask)
    torch.testing.assert_close(actual, expected.transpose(1, 2).contiguous(), atol=1e-6, rtol=1e-5)
