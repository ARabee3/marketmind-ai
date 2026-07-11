import re
from typing import Final

from app.discovery.schemas import LanguageMode


URL_PATTERN: Final = re.compile(r"https?://\S+|www\.\S+")


def question_matches_language(question: str, language_mode: LanguageMode) -> bool:
    if language_mode != "ar-EG":
        return True

    text = URL_PATTERN.sub("", question)
    arabic_letters = 0
    latin_letters = 0
    for char in text:
        if not char.isalpha():
            continue
        if "\u0600" <= char <= "\u06ff":
            arabic_letters += 1
        elif "A" <= char <= "Z" or "a" <= char <= "z":
            latin_letters += 1

    counted_letters = arabic_letters + latin_letters
    return arabic_letters >= 3 and (
        counted_letters == 0 or arabic_letters / counted_letters >= 0.6
    )
