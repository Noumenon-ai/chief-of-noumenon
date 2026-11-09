"""Uses the real audio decoder, because a version mismatch there broke voice live."""
import io
import wave

import pytest


def test_the_installed_decoder_reads_audio():
    audio = pytest.importorskip("faster_whisper.audio")
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(16000)
        out.writeframes(b"\0\0" * 1600)
    buffer.seek(0)
    assert len(audio.decode_audio(buffer)) > 0
