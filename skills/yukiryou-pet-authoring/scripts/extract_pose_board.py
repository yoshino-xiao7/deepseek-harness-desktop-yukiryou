#!/usr/bin/env python3
"""Extract complete-character key poses from a regular chroma pose board."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--columns", required=True, type=int)
    parser.add_argument("--rows", required=True, type=int)
    args = parser.parse_args()
    if args.columns < 1 or args.rows < 1:
        raise ValueError("grid dimensions must be positive")

    board = Image.open(args.input).convert("RGBA")
    cell_width = board.width / args.columns
    cell_height = board.height / args.rows
    args.output.mkdir(parents=True, exist_ok=False)

    records: list[dict[str, object]] = []
    for index in range(args.columns * args.rows):
        column = index % args.columns
        row = index // args.columns
        left = round(column * cell_width)
        top = round(row * cell_height)
        right = round((column + 1) * cell_width)
        bottom = round((row + 1) * cell_height)
        cell = board.crop((left, top, right, bottom))
        pixels = []
        for red, green, blue, alpha in cell.getdata():
            greenness = green - max(red, blue)
            if green > 110 and greenness >= 48:
                output_alpha = 0
            elif green > 95 and greenness > 14:
                output_alpha = round(alpha * (48 - greenness) / 34)
            else:
                output_alpha = alpha
            output_alpha = max(0, min(255, output_alpha))
            if output_alpha == 0:
                pixels.append((0, 0, 0, 0))
                continue
            if output_alpha < alpha:
                coverage = output_alpha / alpha
                red = round(red / coverage)
                green = round((green - 255 * (1 - coverage)) / coverage)
                blue = round(blue / coverage)
                red = max(0, min(255, red))
                green = max(0, min(255, green))
                blue = max(0, min(255, blue))
            pixels.append((red, green, blue, output_alpha))
        cell.putdata(pixels)
        bounds = cell.getchannel("A").point(lambda value: 255 if value > 8 else 0).getbbox()
        if bounds is None:
            raise ValueError(f"pose {index + 1} has no visible character")
        output = args.output / f"{index + 1:02d}.png"
        cell.save(output, optimize=True)
        records.append({
            "index": index + 1,
            "path": output.name,
            "bounds": {"left": bounds[0], "top": bounds[1], "right": bounds[2], "bottom": bounds[3]},
        })

    print(json.dumps({
        "status": "complete",
        "board": {"width": board.width, "height": board.height},
        "grid": {"columns": args.columns, "rows": args.rows},
        "cell": {"nominalWidth": cell_width, "nominalHeight": cell_height},
        "poses": records,
    }, ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
