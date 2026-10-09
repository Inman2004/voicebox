"""Check delivery files with a real encoder and decoder."""

import asyncio
import io
import math
import struct
import subprocess
import wave

import pytest
from fastapi import HTTPException
from imageio_ffmpeg import get_ffmpeg_exe

from backend.services.audio_export import encode_audio


def tone():
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(24000)
        audio.writeframes(
            b"".join(struct.pack("<h", int(8000 * math.sin(i * math.tau * 440 / 24000))) for i in range(24000))
        )
    return buffer.getvalue()


@pytest.mark.parametrize("output_format", ["wav", "mp3", "m4a"])
@pytest.mark.parametrize("from_bytes", [True, False])
def test_export_decodes_to_original_duration(tmp_path, output_format, from_bytes):
    original = tone()
    source = tmp_path / "source.wav"
    source.write_bytes(original)
    encoded = asyncio.run(encode_audio(original if from_bytes else source, output_format))
    output = tmp_path / f"export.{output_format}"
    output.write_bytes(encoded)
    decoded = subprocess.run(
        [get_ffmpeg_exe(), "-v", "error", "-i", str(output), "-f", "s16le", "-ar", "24000", "-ac", "1", "pipe:1"],
        capture_output=True,
        check=True,
    ).stdout
    assert abs(len(decoded) / 48000 - 1) < 0.1
    samples = struct.unpack(f"<{len(decoded) // 2}h", decoded)
    assert max(samples) > 6000
    assert source.read_bytes() == original
    if output_format == "wav":
        assert encoded[:4] == b"RIFF"
    elif output_format == "m4a":
        assert encoded[4:8] == b"ftyp"


def test_imported_mp3_can_be_exported_as_wav(tmp_path):
    mp3 = tmp_path / "imported.mp3"
    mp3.write_bytes(asyncio.run(encode_audio(tone(), "mp3")))
    result = asyncio.run(encode_audio(mp3, "wav"))
    with wave.open(io.BytesIO(result)) as audio:
        assert audio.getnframes() / audio.getframerate() == pytest.approx(1, abs=0.1)


def test_missing_encoder_has_actionable_error(monkeypatch):
    def unavailable():
        raise RuntimeError("Missing encoder")

    monkeypatch.setattr("imageio_ffmpeg.get_ffmpeg_exe", unavailable)
    with pytest.raises(HTTPException) as error:
        asyncio.run(encode_audio(tone(), "m4a"))
    assert error.value.status_code == 503


def test_encoder_failure_removes_temporary_files(monkeypatch):
    paths = []

    def fail(command, **kwargs):
        from pathlib import Path

        paths.append(Path(command[-1]).parent)
        raise subprocess.TimeoutExpired(command, 300)

    monkeypatch.setattr("backend.services.audio_export.subprocess.run", fail)
    monkeypatch.setattr("imageio_ffmpeg.get_ffmpeg_exe", lambda: "ffmpeg")
    with pytest.raises(HTTPException) as error:
        asyncio.run(encode_audio(tone(), "mp3"))
    assert error.value.status_code == 500
    assert not paths[0].exists()
