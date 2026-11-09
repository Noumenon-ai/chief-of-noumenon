"""Local voice transcription shared by Telegram and the owner browser.

The existing Telegram setting and model cache remain the configuration source.
Temporary recordings are removed on success and failure; content is never logged.
"""
import asyncio
import logging
import tempfile
import threading
from pathlib import Path

from app.core.config import settings

logger = logging.getLogger(__name__)
VOICE_LIMIT = 20 * 1024 * 1024
_model = None
_lock = threading.Lock()
_preparing = None
MODEL_WAIT_SECONDS = 10


def can_record(principal):
    return principal is not None and (
        (principal.is_admin or "chat" in principal.scopes) and "assistant" not in principal.scopes
        and principal.tenant_id is None and principal.kind in ("browser", "desktop", "loopback")
    )


def allowed_languages():
    return list(dict.fromkeys(code.strip().lower() for code in settings.TELEGRAM_VOICE_LANGUAGES.split(',') if code.strip()))


class VoiceModelPreparing(ValueError):
    def __init__(self):
        super().__init__("Preparing voice model, try again in a minute")


def _load_model(folder):
    global _model
    if _model is not None:
        return
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        raise ValueError("Voice needs the optional voice package. Install the backend with its voice extra, then retry.") from None
    folder.mkdir(parents=True, exist_ok=True)
    try:
        device = settings.VOICE_DEVICE
        if device == "auto":
            import ctranslate2
            device = "cuda" if ctranslate2.get_cuda_device_count() > 0 else "cpu"
        options = {"download_root": str(folder / "whisper-models")}
        if device == "cuda":
            try:
                _model = WhisperModel(settings.VOICE_MODEL, device="cuda", compute_type="float16", **options)
                return
            except Exception as exc:
                logger.warning("voice_cuda_load_failed falling_back=cpu error_type=%s", type(exc).__name__)
        _model = WhisperModel(settings.VOICE_MODEL, device="cpu", compute_type="int8", **options)
    except Exception as exc:
        logger.warning('voice_model_load_failed error_type=%s', type(exc).__name__)
        raise ValueError("Local voice transcription failed on this server. The owner can check the voice model download and the server log.") from None


def prepare_model(folder):
    with _lock:
        _load_model(folder)


async def ensure_model_ready(folder):
    """One model-only worker survives an HTTP timeout; it never holds recording bytes."""
    global _preparing
    if _model is not None:
        return
    if _preparing is None:
        _preparing = asyncio.create_task(asyncio.to_thread(prepare_model, folder))
        # Retrieve late failures even if the browser never retries.
        _preparing.add_done_callback(lambda task: task.exception() if not task.cancelled() else None)
    task = _preparing
    try:
        await asyncio.wait_for(asyncio.shield(task), timeout=MODEL_WAIT_SECONDS)
    except TimeoutError:
        raise VoiceModelPreparing() from None
    finally:
        if task.done() and _preparing is task:
            _preparing = None

def voice_language(model, path):
    """Choose among the owner's languages, because short Hebrew notes can be detected as Arabic."""
    allowed = allowed_languages()
    if len(allowed) < 2:
        return allowed[0] if allowed else None
    from faster_whisper.audio import decode_audio
    _, _, ranked = model.detect_language(audio=decode_audio(str(path)), vad_filter=True)
    scores = dict(ranked)
    return max(allowed, key=lambda code: scores.get(code, 0.0))


def _transcribe(data, folder, language=None):
    _load_model(folder)
    folder.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='telegram-audio-', dir=folder) as scratch:
        path = Path(scratch) / 'voice.ogg'
        path.write_bytes(data)
        try:
            segments, _ = _model.transcribe(str(path), language=language or voice_language(_model, path), vad_filter=True)
            text = ' '.join(segment.text.strip() for segment in segments).strip()
        except Exception as exc:
            # The type names the cause without exposing audio, paths or text.
            logger.warning('telegram_transcribe_failed error_type=%s', type(exc).__name__)
            raise ValueError("Local voice transcription failed on this server. Please send text for now. The owner can check the voice model download and the server log.") from None
    if not text:
        raise ValueError("I could not hear speech in that voice note. Please send text or try again.")
    return text


def transcribe(data, folder, language=None):
    # Model initialization and inference share a lock across both transports.
    with _lock:
        return _transcribe(data, folder, language)
