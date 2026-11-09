"""Browser recordings use real auth, CSRF, bounded streaming and shared local decoding."""
import builtins
import sys
from pathlib import Path
from types import SimpleNamespace as NS

import pytest

from app.auth.policy import Principal
from app.routers.voice import require_recording
from app.core.config import settings
from app.services import voice
from app.routers.voice import recording_folder
from tests.auth.test_auth_api import (app, auth_settings, client, factory, login, pairing_code, set_owner)  # noqa: F401

PATH = "/api/v1/voice/transcribe"


@pytest.fixture(autouse=True)
def fake_model(monkeypatch, tmp_path, app):
    app.dependency_overrides[recording_folder] = lambda: tmp_path
    
    monkeypatch.setattr(settings, "TELEGRAM_VOICE_LANGUAGES", "he,en")
    monkeypatch.setattr(settings, "LOCAL_EXECUTION_ENABLED", False)
    monkeypatch.setattr(settings, "VOICE_DEVICE", "auto")
    monkeypatch.setitem(sys.modules, "ctranslate2", NS(get_cuda_device_count=lambda: 0))
    monkeypatch.setattr(voice, "_model", None)
    monkeypatch.setattr(voice, "_preparing", None)
    monkeypatch.setitem(sys.modules, "faster_whisper.audio", NS(decode_audio=lambda path: b"pcm"))
    class Model:
        def __init__(self, *args, **kwargs):
            pass
        def detect_language(self, **kwargs):
            return "ar", 0.9, [("ar", 0.9), ("he", 0.08), ("en", 0.02)]
        def transcribe(self, path, **kwargs):
            assert Path(path).read_bytes() == b"private audio"
            assert kwargs == {"language": "he", "vad_filter": True}
            return [NS(text="שלום hello")], NS()
    monkeypatch.setitem(sys.modules, "faster_whisper", NS(WhisperModel=Model))


async def post_as_owner(app, factory, content=b"private audio", **kwargs):
    await set_owner(factory)
    async with client(app) as owner:
        csrf = (await login(owner))["csrf_token"]
        return await owner.post(PATH, content=content, headers={"X-CSRF-Token": csrf, **kwargs})


async def test_happy_path_and_cleanup(app, factory, tmp_path, caplog):
    response = await post_as_owner(app, factory)
    assert response.status_code == 200
    assert response.json() == {"text": "שלום hello"}
    assert not list(tmp_path.rglob("voice.ogg"))
    assert not list(tmp_path.rglob("telegram-audio-*"))
    assert "private audio" not in caplog.text and "שלום" not in caplog.text


async def test_no_auth(app):
    async with client(app) as stranger:
        assert (await stranger.post(PATH, content=b"x")).status_code == 401


async def test_wrong_user(app, factory):
    # A hosted principal must not use the single-owner local voice model.
    app.dependency_overrides[require_recording] = lambda: Principal(kind="account", tenant_id="another-owner")
    try:
        response = await post_as_owner(app, factory)
        assert response.status_code == 403
    finally:
        app.dependency_overrides.pop(require_recording)


async def test_requires_csrf(app, factory):
    await set_owner(factory)
    async with client(app) as owner:
        await login(owner)
        assert (await owner.post(PATH, content=b"x")).status_code == 403


async def test_oversize_header(app, factory):
    response = await post_as_owner(app, factory, **{"Content-Length": str(voice.VOICE_LIMIT + 1)})
    assert response.status_code == 413


async def test_oversize_stream(app, factory):
    async def chunks():
        for _ in range(21):
            yield b"x" * (1024 * 1024)
    response = await post_as_owner(app, factory, content=chunks())
    assert response.status_code == 413


async def test_missing_package(app, factory, monkeypatch, tmp_path):
    original = builtins.__import__
    def missing(name, *args, **kwargs):
        if name == "faster_whisper":
            raise ImportError()
        return original(name, *args, **kwargs)
    monkeypatch.setattr(builtins, "__import__", missing)
    response = await post_as_owner(app, factory)
    assert response.status_code == 422 and "voice extra" in response.json()["detail"]
    assert not list(tmp_path.rglob("voice.ogg"))


@pytest.mark.parametrize("fails", [False, True])
async def test_no_speech_or_failed_decode_cleans_up(app, factory, monkeypatch, tmp_path, fails, caplog):
    class Model:
        def transcribe(self, path, **kwargs):
            if fails:
                raise RuntimeError("private audio and text")
            return [], NS()
    monkeypatch.setattr(settings, "TELEGRAM_VOICE_LANGUAGES", "he")
    monkeypatch.setattr(voice, "_model", Model())
    response = await post_as_owner(app, factory)
    assert response.status_code == 422
    assert ("transcription failed" if fails else "could not hear speech") in response.json()["detail"]
    assert not list(tmp_path.rglob("voice.ogg"))
    assert not list(tmp_path.rglob("telegram-audio-*"))
    assert "private audio and text" not in caplog.text


async def test_empty_recording(app, factory):
    assert (await post_as_owner(app, factory, content=b"")).status_code == 422



async def test_paired_device_is_not_the_owner_browser(app, factory):
    await set_owner(factory)
    async with client(app) as owner:
        code = await pairing_code(owner, (await login(owner))["csrf_token"], scope="admin")
    async with client(app) as device:
        token = (await device.post("/api/v1/auth/pair", json={"code": code})).json()["token"]
        response = await device.post(PATH, content=b"private audio", headers={"Authorization": f"Bearer {token}"})
        assert response.status_code == 403


async def test_folder_failure_is_actionable(app, factory, tmp_path):
    blocked = tmp_path / "not-a-folder"
    blocked.write_text("occupied")
    app.dependency_overrides[recording_folder] = lambda: blocked
    response = await post_as_owner(app, factory)
    assert response.status_code == 503
    assert "permissions" in response.json()["detail"]
    assert not list(tmp_path.rglob("voice.ogg"))


async def test_chat_paired_browser_can_record_with_csrf(app, factory):
    await set_owner(factory)
    async with client(app) as owner:
        code = await pairing_code(owner, (await login(owner))['csrf_token'], scope='chat')
    async with client(app) as phone:
        session = (await phone.post('/api/v1/auth/pair', json={'code': code, 'cookie': True})).json()['session']
        assert (await phone.post(PATH, content=b'private audio')).status_code == 403
        response = await phone.post(PATH, content=b'private audio', headers={'X-CSRF-Token': session['csrf_token']})
        assert response.status_code == 200 and response.json()['text'] == 'שלום hello'
        assert (await phone.get('/api/v1/local/status')).json()['voice'] == {"languages": ["he", "en"], "default": "auto", "browser_speech": True}


@pytest.mark.parametrize("language,expected", [(None, "he"), ("auto", "he"), ("he", "he"), ("en", "en")])
async def test_language_reaches_model(app, factory, monkeypatch, language, expected):
    calls = []
    class Model:
        def detect_language(self, **kwargs):
            assert language in (None, "auto"), "Forced language must skip detection"
            return "he", 0.8, [("he", 0.8), ("en", 0.2)]
        def transcribe(self, path, **kwargs):
            calls.append(kwargs)
            return [NS(text="שלום")], NS()
    monkeypatch.setattr(voice, "_model", Model())
    await set_owner(factory)
    async with client(app) as owner:
        csrf = (await login(owner))["csrf_token"]
        response = await owner.post(PATH, params={} if language is None else {"language": language},
                                    content=b"private audio", headers={"X-CSRF-Token": csrf})
    assert response.status_code == 200
    assert calls == [{"language": expected, "vad_filter": True}]


@pytest.mark.parametrize("language", ["fr", "unknown", "", "HE", "auto,he"])
async def test_unknown_language_is_rejected_before_model_load(app, factory, monkeypatch, language):
    def unexpected(*args):
        pytest.fail("Invalid language must not load the model")
    monkeypatch.setattr(voice, "prepare_model", unexpected)
    await set_owner(factory)
    async with client(app) as owner:
        csrf = (await login(owner))["csrf_token"]
        response = await owner.post(PATH, params={"language": language}, content=b"private audio", headers={"X-CSRF-Token": csrf})
    assert response.status_code == 422


async def test_voice_capabilities_only_for_owner_browser(app, factory, monkeypatch):
    monkeypatch.setattr(settings, "LOCAL_EXECUTION_ENABLED", False)
    async with client(app) as stranger:
        assert (await stranger.get('/api/v1/local/status')).status_code == 401
    await set_owner(factory)
    async with client(app) as owner:
        csrf = (await login(owner))["csrf_token"]
        assert (await owner.get('/api/v1/local/status')).json()['voice'] == {"languages": ["he", "en"], "default": "auto", "browser_speech": True}
        code = await pairing_code(owner, csrf, scope="admin")
    async with client(app) as device:
        token = (await device.post('/api/v1/auth/pair', json={"code": code})).json()['token']
        assert (await device.get('/api/v1/local/status', headers={"Authorization": f"Bearer {token}"})).json()['voice'] is None


async def test_slow_model_load_returns_preparing_and_reuses_worker(app, factory, monkeypatch, tmp_path):
    import asyncio
    import threading
    started, release = threading.Event(), threading.Event()
    calls = []
    event_loop_thread = threading.get_ident()
    def slow(folder):
        assert threading.get_ident() != event_loop_thread
        calls.append(folder)
        started.set()
        assert release.wait(10)
    monkeypatch.setattr(voice, "prepare_model", slow)
    monkeypatch.setattr(voice, "MODEL_WAIT_SECONDS", 0.01)
    try:
        response = await post_as_owner(app, factory)
        assert started.is_set()
        assert response.status_code == 503
        assert response.json()["detail"] == "Preparing voice model, try again in a minute"
        assert response.headers['retry-after'] == '60'
        with pytest.raises(voice.VoiceModelPreparing):
            await voice.ensure_model_ready(tmp_path)
        assert calls == [tmp_path]
        assert not list(tmp_path.rglob('voice.ogg'))
    finally:
        release.set()
        if voice._preparing:
            await asyncio.wait_for(voice._preparing, 5)
    # A retry consumes the completed worker instead of starting another download.
    await voice.ensure_model_ready(tmp_path)
    assert calls == [tmp_path]


@pytest.mark.parametrize("enabled", [True, False])
async def test_browser_speech_status_setting(app, factory, monkeypatch, enabled):
    from app.core.config import Settings
    assert Settings.model_fields["VOICE_BROWSER_SPEECH"].default is True
    monkeypatch.setattr(settings, "VOICE_BROWSER_SPEECH", enabled)
    await set_owner(factory)
    async with client(app) as owner:
        await login(owner)
        response = await owner.get("/api/v1/local/status")
    assert response.status_code == 200
    assert response.json()["voice"]["browser_speech"] is enabled
