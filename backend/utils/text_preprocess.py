"""
Text preprocessing applied before synthesis.

Each option is independent and safe to combine. Inline pause tags
(``<500ms>``, ``<1s>``) and bracket tags (``[laugh]``) are shielded from
every transform so they reach :mod:`utils.pauses` / the engine intact.
"""

from __future__ import annotations

import logging
import re
from typing import Callable, Iterable, Optional

logger = logging.getLogger("voicebox.text-preprocess")

PAUSE_TAG_PATTERN = r"<\s*\d+(?:\.\d+)?\s*(?:ms|s)\s*>"
_PAUSE_TAG_RE = re.compile(PAUSE_TAG_PATTERN, re.IGNORECASE)
_BRACKET_TAG_RE = re.compile(r"\[[^\]\n]*\]")
# [1], [12], [3, 4], [5-7], [2–9] — citation markers. Words in brackets
# (Chatterbox tags) never match.
_REFERENCE_RE = re.compile(r"[ \t]*\[\d+(?:\s*[,–—-]\s*\d+)*\]")
# J.R.R. / U.S.A. / J. R. R.  — two or more dotted single capitals
_INITIALS_RE = re.compile(r"\b(?:[A-Z]\.\s?){2,}")

_PLACEHOLDER_OPEN = ""
_PLACEHOLDER_CLOSE = ""
_PLACEHOLDER_RE = re.compile(f"{_PLACEHOLDER_OPEN}(.){_PLACEHOLDER_CLOSE}", re.DOTALL)


def _protect(text: str) -> tuple[str, list[str]]:
    """Swap pause and bracket tags for private-use placeholders.

    Placeholders contain no digits, letters or whitespace, so no transform
    below can alter them.
    """
    saved: list[str] = []

    def stash(m: re.Match) -> str:
        saved.append(m.group(0))
        return f"{_PLACEHOLDER_OPEN}{chr(0xE100 + len(saved) - 1)}{_PLACEHOLDER_CLOSE}"

    text = _PAUSE_TAG_RE.sub(stash, text)
    text = _BRACKET_TAG_RE.sub(stash, text)
    return text, saved


def _restore(text: str, saved: list[str]) -> str:
    return _PLACEHOLDER_RE.sub(lambda m: saved[ord(m.group(1)) - 0xE100], text)


# ---------------------------------------------------------------------------
# Individual transforms
# ---------------------------------------------------------------------------


def remove_reference_numbers(text: str) -> str:
    return _REFERENCE_RE.sub("", text)


def apply_replacements(text: str, replacements: Iterable[tuple[str, str]]) -> str:
    """Whole-word, case-insensitive substitutions (``AI`` → ``A I``)."""
    for source, target in replacements:
        source = source.strip()
        if not source:
            continue
        pattern = re.compile(rf"(?<!\w){re.escape(source)}(?!\w)", re.IGNORECASE)
        text = pattern.sub(lambda _m, t=target: t, text)
    return text


def fix_initials(text: str) -> str:
    """``J.R.R. Tolkien`` → ``J R R Tolkien`` so engines don't pause at every dot."""

    def repl(m: re.Match) -> str:
        letters = re.findall(r"[A-Z]", m.group(0))
        trailing = " " if m.group(0).endswith(" ") else ""
        return " ".join(letters) + trailing

    return _INITIALS_RE.sub(repl, text)


def normalize_whitespace(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[ \t  -​]+", " ", text)
    text = re.sub(r" *\n *", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = re.sub(r" +([,.;:!?])", r"\1", text)
    return text.strip()


def lowercase(text: str) -> str:
    return text.lower()


# --- Numbers & dates --------------------------------------------------------

_MONTHS = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
]

_NUM2WORDS_LANG = {
    "en": "en", "es": "es", "fr": "fr", "de": "de", "it": "it", "pt": "pt",
    "ru": "ru", "ja": "ja", "ko": "ko", "pl": "pl", "nl": "nl", "da": "dk",
    "no": "no", "sv": "sv", "fi": "fi", "tr": "tr", "he": "he", "ar": "ar",
    "hi": "hi", "zh": "zh",
}


def _num2words_fn(language: str) -> Optional[Callable[..., str]]:
    try:
        from num2words import num2words
    except ImportError:
        logger.warning("num2words not installed; smart numbers disabled")
        return None
    lang = _NUM2WORDS_LANG.get(language)
    if lang is None:
        return None

    def convert(value, to: str = "cardinal") -> str:
        try:
            return num2words(value, lang=lang, to=to)
        except (NotImplementedError, OverflowError, ValueError):
            return num2words(value, lang="en", to=to) if lang == "en" else str(value)

    return convert


def _spell_decimal(raw: str, n2w: Callable[..., str], point_word: str) -> str:
    whole, _, frac = raw.partition(".")
    words = n2w(int(whole))
    if frac:
        words += f" {point_word} " + " ".join(n2w(int(d)) for d in frac)
    return words


def expand_numbers(text: str, language: str = "en") -> str:
    """Spell out numbers, currency, percentages, ordinals, dates and times.

    Date, currency and time handling is English-only; other languages get
    cardinal and decimal expansion through num2words.
    """
    n2w = _num2words_fn(language)
    if n2w is None:
        return text
    english = language == "en"

    if english:
        # ISO dates 2024-03-15 and US dates 3/15/2024
        def iso_date(m: re.Match) -> str:
            y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
            if not (1 <= mo <= 12 and 1 <= d <= 31):
                return m.group(0)
            return f"{_MONTHS[mo - 1]} {n2w(d, to='ordinal')}, {n2w(y, to='year')}"

        def us_date(m: re.Match) -> str:
            mo, d, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
            if not (1 <= mo <= 12 and 1 <= d <= 31):
                return m.group(0)
            if y < 100:
                y += 2000
            return f"{_MONTHS[mo - 1]} {n2w(d, to='ordinal')}, {n2w(y, to='year')}"

        text = re.sub(r"\b(\d{4})-(\d{1,2})-(\d{1,2})\b", iso_date, text)
        text = re.sub(r"\b(\d{1,2})/(\d{1,2})/(\d{2}|\d{4})\b", us_date, text)

        # Times 10:30, 9:05 am
        def time_repl(m: re.Match) -> str:
            h, mi = int(m.group(1)), int(m.group(2))
            if h > 23 or mi > 59:
                return m.group(0)
            if mi == 0:
                spoken = f"{n2w(h)} o'clock" if not m.group(3) else n2w(h)
            elif mi < 10:
                spoken = f"{n2w(h)} oh {n2w(mi)}"
            else:
                spoken = f"{n2w(h)} {n2w(mi)}"
            if m.group(3):
                spoken += " " + " ".join(m.group(3).replace(".", "").upper())
            return spoken

        text = re.sub(r"\b(\d{1,2}):(\d{2})(?:\s?([AaPp]\.?[Mm]\.?))?\b", time_repl, text)

        # Currency $1,234.56 / €20 / £5
        currencies = {"$": ("dollar", "dollars"), "€": ("euro", "euros"), "£": ("pound", "pounds")}

        def money(m: re.Match) -> str:
            singular, plural = currencies[m.group(1)]
            amount = m.group(2).replace(",", "")
            whole, _, cents = amount.partition(".")
            w = int(whole)
            words = f"{n2w(w)} {singular if w == 1 else plural}"
            if cents:
                c = int((cents + "0")[:2])
                if c:
                    words += f" and {n2w(c)} {'cent' if c == 1 else 'cents'}"
            return words

        text = re.sub(r"([$€£])\s?(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)", money, text)

        # Ordinals 1st 2nd 3rd 21st
        text = re.sub(
            r"\b(\d+)(st|nd|rd|th)\b",
            lambda m: n2w(int(m.group(1)), to="ordinal"),
            text,
            flags=re.IGNORECASE,
        )

        # Standalone years 1100–2099 read as years ("nineteen eighty-four")
        text = re.sub(
            r"(?<![\d.,])\b(1[1-9]\d\d|20\d\d)\b(?![\d.,]\d)",
            lambda m: n2w(int(m.group(1)), to="year"),
            text,
        )

    point_word = {"en": "point", "es": "coma", "fr": "virgule", "de": "Komma", "it": "virgola", "pt": "vírgula"}.get(
        language, "point"
    )

    # Percentages
    percent_word = {"en": "percent", "es": "por ciento", "fr": "pour cent", "de": "Prozent", "it": "per cento", "pt": "por cento"}.get(
        language, "percent"
    )
    text = re.sub(
        r"(\d+(?:\.\d+)?)\s?%",
        lambda m: f"{_spell_decimal(m.group(1), n2w, point_word)} {percent_word}",
        text,
    )

    # Grouped thousands 1,234,567 then plain integers/decimals
    text = re.sub(
        r"\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b",
        lambda m: _spell_decimal(m.group(0).replace(",", ""), n2w, point_word),
        text,
    )
    text = re.sub(
        r"\b\d+(?:\.\d+)?\b",
        lambda m: _spell_decimal(m.group(0), n2w, point_word),
        text,
    )
    return text


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def preprocess_text(text: str, options, language: str = "en") -> str:
    """Apply the enabled preprocessing steps from *options*.

    *options* is a :class:`models.PreprocessingOptions` (or any object with
    the same attributes). Returns *text* unchanged when *options* is None.
    """
    if options is None:
        return text

    if getattr(options, "remove_reference_numbers", False):
        text = remove_reference_numbers(text)

    text, saved = _protect(text)

    replacements = getattr(options, "replacements", None) or []
    if replacements:
        text = apply_replacements(
            text,
            [(r.source, r.target) if hasattr(r, "source") else (r["from"], r.get("to", "")) for r in replacements],
        )
    if getattr(options, "fix_initials", False):
        text = fix_initials(text)
    if getattr(options, "smart_numbers", False):
        text = expand_numbers(text, language)
    if getattr(options, "lowercase", False):
        text = lowercase(text)
    if getattr(options, "normalize_whitespace", False):
        text = normalize_whitespace(text)

    return _restore(text, saved)
