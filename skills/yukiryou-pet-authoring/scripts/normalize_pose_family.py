#!/usr/bin/env python3
"""Normalize a complete-character pose family with one shared scale and baseline."""

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
    parser.add_argument("--scale", type=float)
    args = parser.parse_args()

    paths = sorted(args.input.glob("*.png"))
    if len(paths) < 2:
        raise ValueError("pose family requires at least two PNG files")
    sources: list[tuple[Path, Image.Image, tuple[int, int, int, int]]] = []
    for path in paths:
        image = Image.open(path).convert("RGBA")
        bounds = image.getchannel("A").point(lambda value: 255 if value > 8 else 0).getbbox()
        if bounds is None:
            raise ValueError(f"{path.name} has no visible character")
        sources.append((path, image, bounds))

    max_width = max(bounds[2] - bounds[0] for _, _, bounds in sources)
    max_height = max(bounds[3] - bounds[1] for _, _, bounds in sources)
    maximum_scale = min(
        (CELL_WIDTH - 2 * MARGIN) / max_width,
        (CELL_HEIGHT - 2 * MARGIN) / max_height,
    )
    scale = maximum_scale if args.scale is None else args.scale
    if scale <= 0 or scale > maximum_scale:
        raise ValueError(f"scale must be positive and no greater than {maximum_scale}")
    args.output.mkdir(parents=True, exist_ok=True)
    if any(args.output.iterdir()):
        raise ValueError("output directory must be empty")
    records: list[dict[str, object]] = []
    for path, image, bounds in sources:
        foreground = image.crop(bounds)
        width = max(1, round(foreground.width * scale))
        height = max(1, round(foreground.height * scale))
        foreground = foreground.resize((width, height), Image.Resampling.LANCZOS)
        output = Image.new("RGBA", (CELL_WIDTH, CELL_HEIGHT), (0, 0, 0, 0))
        x = (CELL_WIDTH - width) // 2
        y = CELL_HEIGHT - MARGIN - height
        output.alpha_composite(foreground, (x, y))
        output_path = args.output / path.name
        output.save(output_path, optimize=True)
        records.append({
            "path": output_path.name,
            "foreground": {"x": x, "y": y, "width": width, "height": height},
        })

    print(json.dumps({
        "status": "complete",
        "scale": scale,
        "sourceEnvelope": {"width": max_width, "height": max_height},
        "poses": records,
    }, ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
