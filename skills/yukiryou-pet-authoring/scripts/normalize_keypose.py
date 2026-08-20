#!/usr/bin/env python3
"""Normalize an agent-generated pose into the fixed YukiRyou pet cell."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image


CELL_WIDTH = 192
CELL_HEIGHT = 208
MARGIN = 4


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()

    image = Image.open(args.input).convert("RGBA")
    alpha = image.getchannel("A")
    mask = alpha.point(lambda value: 255 if value > 8 else 0)
    bounds = mask.getbbox()
    if bounds is None:
        raise ValueError("pose has no visible foreground")
    foreground = image.crop(bounds)
    scale = min(
        (CELL_WIDTH - 2 * MARGIN) / foreground.width,
        (CELL_HEIGHT - 2 * MARGIN) / foreground.height,
    )
    width = max(1, round(foreground.width * scale))
    height = max(1, round(foreground.height * scale))
    foreground = foreground.resize((width, height), Image.Resampling.LANCZOS)

    output = Image.new("RGBA", (CELL_WIDTH, CELL_HEIGHT), (0, 0, 0, 0))
    x = (CELL_WIDTH - width) // 2
    y = CELL_HEIGHT - MARGIN - height
    output.alpha_composite(foreground, (x, y))
    if output.getchannel("A").getbbox() is None:
        raise ValueError("normalized pose has no visible foreground")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    output.save(args.output, optimize=True)
    print(json.dumps({
        "status": "complete",
        "width": CELL_WIDTH,
        "height": CELL_HEIGHT,
        "foreground": {"x": x, "y": y, "width": width, "height": height},
    }, sort_keys=True))


if __name__ == "__main__":
    main()
