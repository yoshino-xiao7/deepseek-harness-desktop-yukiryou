#!/usr/bin/env python3
"""Create the fixed transparent 256px thumbnail used by a yukipet package."""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    options = parser.parse_args()
    source = Image.open(options.input).convert("RGBA")
    bounds = source.getchannel("A").point(lambda value: 255 if value > 8 else 0).getbbox()
    if bounds is None:
        raise ValueError("thumbnail source has no visible foreground")
    foreground = source.crop(bounds)
    scale = min(232 / foreground.width, 232 / foreground.height)
    foreground = foreground.resize(
        (max(1, round(foreground.width * scale)), max(1, round(foreground.height * scale))),
        Image.Resampling.LANCZOS,
    )
    output = Image.new("RGBA", (256, 256), (0, 0, 0, 0))
    output.alpha_composite(foreground, ((256 - foreground.width) // 2, 256 - 12 - foreground.height))
    options.output.parent.mkdir(parents=True, exist_ok=True)
    output.save(options.output, optimize=True)


if __name__ == "__main__":
    main()
