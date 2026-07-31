from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict

UUID = str

ContentChannel = Literal["facebook", "instagram"]
ContentFormat = Literal[
    "static_image_post",
    "short_video_script",
    "carousel_brief",
    "text_post",
]


class FrozenModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
