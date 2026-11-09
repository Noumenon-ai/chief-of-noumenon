"""Bounded recording for owner and paired Chat browsers; auth and CSRF apply."""
import asyncio
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request

from app.auth.policy import Principal
from app.auth.routes import current_principal

from app.core.config import settings
from app.services import voice

router = APIRouter(prefix="/voice", tags=["Voice"])


def require_recording(principal: Principal = Depends(current_principal)) -> Principal:
    """A separate guard allows route-level tests to exercise the tenant boundary."""
    return principal


def recording_folder() -> Path:
    return settings.SQLITE_FILE.parent / "telegram"


@router.post("/transcribe")
async def transcribe_recording(request: Request, principal: Principal = Depends(require_recording), folder: Path = Depends(recording_folder), language: str = "auto"):
    # This single-owner local model is not available to hosted tenants or assistants.
    if not voice.can_record(principal):
        raise HTTPException(403, "Only the owner can transcribe a recording.")
    if language != "auto" and language not in voice.allowed_languages():
        raise HTTPException(422, "Choose Auto or an allowed voice language.")
    length = request.headers.get("content-length")
    if length:
        try:
            oversized = int(length) > voice.VOICE_LIMIT
        except ValueError:
            raise HTTPException(400, "Invalid recording size.") from None
        if oversized:
            raise HTTPException(413, "Voice recordings must be 20 MB or smaller.")
    data = bytearray()
    async for chunk in request.stream():
        if len(data) + len(chunk) > voice.VOICE_LIMIT:
            raise HTTPException(413, "Voice recordings must be 20 MB or smaller.")
        data.extend(chunk)
    if not data:
        raise HTTPException(422, "No audio was recorded. Try again.")
    try:
        await voice.ensure_model_ready(folder)
        text = await asyncio.to_thread(voice.transcribe, bytes(data), folder, None if language == "auto" else language)
    except voice.VoiceModelPreparing as exc:
        raise HTTPException(503, str(exc), headers={"Retry-After": "60"}) from None
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None
    except OSError:
        raise HTTPException(503, "The server could not store the recording. Check its voice folder permissions.") from None
    finally:
        data.clear()
    return {"text": text}
