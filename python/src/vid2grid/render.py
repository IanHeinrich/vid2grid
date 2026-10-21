from collections.abc import Sequence
from functools import lru_cache
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from .contract import PlannedSheet, RenderPlan

_ANCHORS = {"top-left": "la", "top-right": "ra"}


def paint_sheet(
    plan: RenderPlan, sheet: PlannedSheet, images: Sequence[Image.Image | None]
) -> Image.Image:
    canvas = Image.new("RGB", plan.canvas.as_tuple(), plan.style.background)
    draw = ImageDraw.Draw(canvas)

    for cell, image in zip(sheet.cells, images, strict=False):
        if image is None:
            continue
        canvas.paste(image, (cell.x, cell.y))
        for watermark in cell.watermarks:
            draw.text(
                (watermark.x, watermark.y),
                watermark.text,
                font=_font(watermark.font_size_px),
                anchor=_ANCHORS[watermark.anchor],
                fill=plan.style.text_fill,
                stroke_width=watermark.stroke_width_px,
                stroke_fill=plan.style.text_stroke,
            )
    return canvas


def save_jpeg(image: Image.Image, path: str | Path, quality: int) -> None:
    image.save(path, format="JPEG", quality=quality)


@lru_cache
def _font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    return ImageFont.load_default(size=size)
