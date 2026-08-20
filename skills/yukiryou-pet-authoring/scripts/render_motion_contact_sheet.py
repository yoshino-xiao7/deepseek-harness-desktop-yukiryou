#!/usr/bin/env python3
"""Render deterministic representative frames for human pet-motion QA."""

from __future__ import annotations

import argparse
import math
from pathlib import Path

from PIL import Image, ImageDraw


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--frames", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--samples", type=int, default=12)
    args = parser.parse_args()
    if not 2 <= args.samples <= 24:
        raise ValueError("samples must be between 2 and 24")

    paths = sorted(args.frames.glob("*.png"))
    if len(paths) < args.samples:
        raise ValueError("not enough dense frames")
    indices = [round(index * (len(paths) - 1) / (args.samples - 1)) for index in range(args.samples)]
    frames = [Image.open(paths[index]).convert("RGBA") for index in indices]
    width, height = frames[0].size
    if any(frame.size != (width, height) for frame in frames):
        raise ValueError("frame dimensions differ")

    columns = min(6, args.samples)
    rows = math.ceil(args.samples / columns)
    label_height = 22
    sheet = Image.new("RGB", (columns * width, rows * (height + label_height)), "white")
    draw = ImageDraw.Draw(sheet)
    for slot, (frame, frame_index) in enumerate(zip(frames, indices)):
        x = (slot % columns) * width
        y = (slot // columns) * (height + label_height)
        draw.rectangle((x, y, x + width, y + height), fill=(246, 248, 252))
        sheet.paste(frame, (x, y), frame)
        draw.text((x + 6, y + height + 4), f"frame {frame_index:04d}", fill=(55, 65, 81))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(args.output, optimize=True)


if __name__ == "__main__":
    main()
