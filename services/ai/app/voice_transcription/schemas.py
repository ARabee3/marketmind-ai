from typing import Literal

from pydantic import BaseModel, Field


LanguageHint = Literal["ar-EG", "en", "mixed"]


class VoiceTranscriptionResponse(BaseModel):
    transcript: str = Field(..., min_length=1, max_length=2000)
    language_hint: LanguageHint = "ar-EG"
