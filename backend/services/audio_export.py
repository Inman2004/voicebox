"""Encode delivery audio without modifying the source recording."""

import os
import subprocess
import tempfile
from pathlib import Path
from typing import Literal

from fastapi import HTTPException
from starlette.concurrency import run_in_threadpool

AudioExportFormat = Literal["wav", "mp3", "m4a"]
MEDIA_TYPES = {"wav": "audio/wav", "mp3": "audio/mpeg", "m4a": "audio/mp4"}


def _encode(source: Path | bytes, output_format: AudioExportFormat) -> bytes:
    if output_format == "wav":
        if isinstance(source, bytes):
            return source
        if source.suffix.lower() == ".wav":
            return source.read_bytes()

    try:
        from imageio_ffmpeg import get_ffmpeg_exe

        executable = get_ffmpeg_exe()
    except (ImportError, RuntimeError) as exc:
        raise HTTPException(503, "Audio conversion is unavailable. Install imageio-ffmpeg on the server.") from exc

    with tempfile.TemporaryDirectory(prefix="voicebox-export-") as directory:
        if isinstance(source, bytes):
            input_path = Path(directory) / "source.wav"
            input_path.write_bytes(source)
        else:
            input_path = source
        output_path = Path(directory) / f"audio.{output_format}"
        codec = {
            "wav": ["-c:a", "pcm_s16le"],
            "mp3": ["-c:a", "libmp3lame", "-b:a", "192k"],
            "m4a": ["-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart"],
        }[output_format]
        try:
            subprocess.run(
                [
                    executable,
                    "-nostdin",
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-y",
                    "-i",
                    str(input_path),
                    "-map",
                    "0:a:0",
                    "-vn",
                    *codec,
                    str(output_path),
                ],
                check=True,
                capture_output=True,
                timeout=300,
                creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
            )
        except (OSError, subprocess.SubprocessError) as exc:
            raise HTTPException(500, "Could not encode audio in the selected format.") from exc
        return output_path.read_bytes()


async def encode_audio(source: Path | bytes, output_format: AudioExportFormat) -> bytes:
    return await run_in_threadpool(_encode, source, output_format)
