"""
Inline pause tags.

``Hello <1s> world`` or ``Wait<500ms>what`` — any duration in seconds or
milliseconds. Text is split into speech and silence segments so each speech
segment is synthesized independently and joined with exact-length silence
(no crossfade across a pause).
"""

from __future__ import annotations

import re
from typing import List, Tuple, Union

import numpy as np

from .text_preprocess import PAUSE_TAG_PATTERN

MAX_PAUSE_MS = 10_000

_PAUSE_RE = re.compile(r"<\s*(\d+(?:\.\d+)?)\s*(ms|s)\s*>", re.IGNORECASE)

Segment = Tuple[str, Union[str, int]]  # ("text", str) | ("pause", ms)


def parse_pause_ms(value: str, unit: str) -> int:
    ms = float(value) * (1000 if unit.lower() == "s" else 1)
    return int(max(0, min(MAX_PAUSE_MS, round(ms))))


def strip_pause_tags(text: str) -> str:
    """Remove pause tags entirely (used where silence can't be inserted)."""
    return re.sub(PAUSE_TAG_PATTERN, " ", text, flags=re.IGNORECASE)


def _add_sentence_pauses(text: str, pause_ms: int) -> List[Segment]:
    from .chunked_tts import find_sentence_ends

    segments: List[Segment] = []
    start = 0
    for end in find_sentence_ends(text):
        piece = text[start : end + 1]
        if piece.strip():
            segments.append(("text", piece.strip()))
            segments.append(("pause", pause_ms))
        start = end + 1
    tail = text[start:]
    if tail.strip():
        segments.append(("text", tail.strip()))
    elif segments and segments[-1][0] == "pause":
        segments.pop()  # no trailing pause after the final sentence
    return segments


def split_on_pauses(text: str, sentence_pause_ms: int = 0) -> List[Segment]:
    """Split *text* into ``("text", str)`` and ``("pause", ms)`` segments.

    Adjacent pauses are merged, empty text is dropped. When
    *sentence_pause_ms* > 0 a pause is also inserted after every sentence.
    """
    raw: List[Segment] = []
    pos = 0
    for m in _PAUSE_RE.finditer(text):
        before = text[pos : m.start()]
        if before.strip():
            raw.append(("text", before.strip()))
        raw.append(("pause", parse_pause_ms(m.group(1), m.group(2))))
        pos = m.end()
    tail = text[pos:]
    if tail.strip():
        raw.append(("text", tail.strip()))

    if sentence_pause_ms > 0:
        expanded: List[Segment] = []
        for kind, value in raw:
            if kind == "text":
                expanded.extend(_add_sentence_pauses(str(value), min(sentence_pause_ms, MAX_PAUSE_MS)))
            else:
                expanded.append((kind, value))
        raw = expanded

    merged: List[Segment] = []
    for kind, value in raw:
        if kind == "pause":
            if value == 0:
                continue
            if merged and merged[-1][0] == "pause":
                merged[-1] = ("pause", min(MAX_PAUSE_MS, int(merged[-1][1]) + int(value)))
                continue
        merged.append((kind, value))
    return merged


def has_pauses(segments: List[Segment]) -> bool:
    return any(kind == "pause" for kind, _ in segments)


def silence(ms: int, sample_rate: int) -> np.ndarray:
    return np.zeros(int(round(sample_rate * ms / 1000)), dtype=np.float32)
