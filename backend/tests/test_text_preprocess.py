"""Text preprocessing options for the Generate rail."""

import pytest

from backend.models import PreprocessingOptions, WordReplacement
from backend.utils.text_preprocess import (
    apply_replacements,
    expand_numbers,
    fix_initials,
    normalize_whitespace,
    preprocess_text,
    remove_reference_numbers,
)


def _opts(**kw) -> PreprocessingOptions:
    base = dict(
        normalize_whitespace=False,
        smart_numbers=False,
        lowercase=False,
        fix_initials=False,
        remove_reference_numbers=False,
    )
    base.update(kw)
    return PreprocessingOptions(**base)


def test_none_options_is_identity():
    assert preprocess_text("  Hi [1]  ", None) == "  Hi [1]  "


def test_remove_reference_numbers_keeps_paralinguistic_tags():
    text = "Water boils at sea level[1]. It [laugh] really does [2, 3] and [4-6]."
    assert remove_reference_numbers(text) == "Water boils at sea level. It [laugh] really does and."


def test_replacements_are_whole_word_and_case_insensitive():
    out = apply_replacements("AI helps. Said ai. PAID.", [("AI", "A I")])
    assert out == "A I helps. Said A I. PAID."


def test_replacements_from_options_use_from_to_aliases():
    opts = _opts(replacements=[WordReplacement(**{"from": "OpenVox", "to": "Open Vox"})])
    assert preprocess_text("Try OpenVox now", opts) == "Try Open Vox now"


def test_fix_initials():
    assert fix_initials("J.R.R. Tolkien and J. R. Hartley in the U.S.A. today") == (
        "J R R Tolkien and J R Hartley in the U S A today"
    )


def test_fix_initials_leaves_single_sentence_endings():
    assert fix_initials("I chose plan A. Then left.") == "I chose plan A. Then left."


def test_normalize_whitespace():
    assert normalize_whitespace("Hello  \t world .\r\n\n\n\nNext   line ,ok") == "Hello world.\n\nNext line,ok"


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("I have 3 cats", "I have three cats"),
        ("It costs $1,234.50", "It costs one thousand, two hundred and thirty-four dollars and fifty cents"),
        ("Grew 12%", "Grew twelve percent"),
        ("the 21st floor", "the twenty-first floor"),
        ("born in 1984", "born in nineteen eighty-four"),
        ("pi is 3.14", "pi is three point one four"),
        ("on 2024-03-15", "on March fifteenth, twenty twenty-four"),
        ("at 9:05", "at nine oh five"),
    ],
)
def test_expand_numbers_english(text, expected):
    assert expand_numbers(text, "en") == expected


def test_expand_numbers_other_language_uses_cardinals():
    assert expand_numbers("Tengo 3 gatos", "es") == "Tengo tres gatos"


def test_pause_tags_survive_every_transform():
    opts = _opts(
        normalize_whitespace=True,
        smart_numbers=True,
        lowercase=True,
        fix_initials=True,
        remove_reference_numbers=True,
    )
    out = preprocess_text("Wait <500ms> for 2 SECONDS <1.5s> then [laugh] go[1].", opts)
    assert out == "wait <500ms> for two seconds <1.5s> then [laugh] go."


def test_lowercase_does_not_touch_tags():
    assert preprocess_text("HELLO [Sigh] <1S>", _opts(lowercase=True)) == "hello [Sigh] <1S>"
