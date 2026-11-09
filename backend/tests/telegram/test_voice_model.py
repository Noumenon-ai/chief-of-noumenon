"""Hardware selection and initialization use fakes; never load a model or query a GPU."""
import sys
from types import SimpleNamespace as NS

import pytest

from app.core.config import Settings, settings
from app.services import voice


@pytest.mark.parametrize("device,gpus,expected", [("auto", 0, "cpu"), ("auto", 1, "cuda"), ("cpu", 1, "cpu"), ("cuda", 0, "cuda")])
def test_device_and_model_choice(monkeypatch, tmp_path, device, gpus, expected):
    calls = []
    def count():
        assert device == "auto", "Explicit devices must not probe CUDA"
        return gpus
    class Model:
        def __init__(self, model, **kwargs):
            calls.append((model, kwargs))
    monkeypatch.setattr(voice, "_model", None)
    monkeypatch.setattr(settings, "VOICE_MODEL", "large-v3")
    monkeypatch.setattr(settings, "VOICE_DEVICE", device)
    monkeypatch.setitem(sys.modules, "ctranslate2", NS(get_cuda_device_count=count))
    monkeypatch.setitem(sys.modules, "faster_whisper", NS(WhisperModel=Model))
    voice.prepare_model(tmp_path)
    voice.prepare_model(tmp_path)
    assert calls == [("large-v3", {"device": expected, "compute_type": "float16" if expected == "cuda" else "int8", "download_root": str(tmp_path / "whisper-models")})]


@pytest.mark.parametrize("device", ["auto", "cuda"])
def test_cuda_failure_falls_back_to_cpu(monkeypatch, tmp_path, caplog, device):
    calls = []
    class Model:
        def __init__(self, model, **kwargs):
            calls.append(kwargs)
            if kwargs['device'] == 'cuda':
                raise RuntimeError("private device details")
    monkeypatch.setattr(voice, "_model", None)
    monkeypatch.setattr(settings, "VOICE_DEVICE", device)
    monkeypatch.setitem(sys.modules, "ctranslate2", NS(get_cuda_device_count=lambda: 1))
    monkeypatch.setitem(sys.modules, "faster_whisper", NS(WhisperModel=Model))
    voice.prepare_model(tmp_path)
    assert [call['device'] for call in calls] == ['cuda', 'cpu']
    assert [call['compute_type'] for call in calls] == ['float16', 'int8']
    assert isinstance(voice._model, Model)
    assert 'falling_back=cpu' in caplog.text
    assert 'private device details' not in caplog.text


def test_invalid_device_rejected():
    with pytest.raises(ValueError, match="VOICE_DEVICE"):
        Settings(TOKEN_ENCRYPTION_KEYS="test", VOICE_DEVICE="gpu")


async def test_voice_preload_is_off_in_tests(monkeypatch):
    from app.main import _preload_voice

    assert settings.VOICE_PRELOAD is False
    monkeypatch.setattr(voice, "prepare_model", lambda folder: pytest.fail("must stay offline"))
    await _preload_voice()


async def test_voice_preload_runs_off_loop_and_shares_the_model(monkeypatch, tmp_path):
    import asyncio
    import threading
    from app.main import _preload_voice

    started, release = threading.Event(), threading.Event()
    calls = []
    loop_thread = threading.get_ident()

    class Model:
        def __init__(self, model, **kwargs):
            assert threading.get_ident() != loop_thread
            calls.append(model)
            started.set()
            assert release.wait(5)

    monkeypatch.setattr(settings, "VOICE_PRELOAD", True)
    monkeypatch.setattr(settings, "VOICE_DEVICE", "cpu")
    monkeypatch.setattr(settings, "SQLITE_PATH", str(tmp_path / "test.db"))
    monkeypatch.setattr(voice, "_model", None)
    monkeypatch.setitem(sys.modules, "faster_whisper", NS(WhisperModel=Model))
    task = asyncio.create_task(_preload_voice())
    try:
        assert await asyncio.to_thread(started.wait, 2)
        assert not task.done(), "warmup must not block the event loop"
    finally:
        release.set()
        await task
    await voice.ensure_model_ready(tmp_path / "telegram")
    assert len(calls) == 1


@pytest.mark.parametrize("failure", [ImportError, RuntimeError])
async def test_voice_preload_failure_is_optional_and_logs_no_details(monkeypatch, caplog, capsys, failure):
    from app.main import _preload_voice

    def fail(folder):
        raise failure("private model path or token")

    monkeypatch.setattr(settings, "VOICE_PRELOAD", True)
    monkeypatch.setitem(sys.modules, "faster_whisper", NS(WhisperModel=object))
    monkeypatch.setattr(voice, "prepare_model", fail)
    await _preload_voice()
    output = caplog.text + capsys.readouterr().out
    assert "private model path or token" not in output
    if failure is RuntimeError:
        assert "voice_preload_failed error_type=RuntimeError" in output


async def test_voice_preload_without_optional_package(monkeypatch):
    from app.main import _preload_voice

    monkeypatch.setattr(settings, "VOICE_PRELOAD", True)
    monkeypatch.setitem(sys.modules, "faster_whisper", None)
    monkeypatch.setattr(voice, "prepare_model", lambda folder: pytest.fail("package missing"))
    await _preload_voice()


def test_voice_preload_disabled_for_isolated_e2e_backend(tmp_path, monkeypatch):
    from tests.e2e.backend import Backend

    monkeypatch.delenv("VOICE_PRELOAD", raising=False)
    assert Backend(tmp_path / "offline").env()["VOICE_PRELOAD"] == "false"
