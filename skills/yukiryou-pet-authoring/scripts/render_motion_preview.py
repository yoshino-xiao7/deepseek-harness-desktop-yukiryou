#!/usr/bin/env python3
"""Render a lightweight animated preview from a dense YukiRyou motion."""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--frames", required=True, action="append", type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--source-fps", type=int, default=60)
    parser.add_argument("--preview-fps", type=int, default=30)
    args = parser.parse_args()
    if args.source_fps < 1 or not 1 <= args.preview_fps <= args.source_fps:
        raise ValueError("invalid frame rate")

    stride = max(1, round(args.source_fps / args.preview_fps))
    frames: list[Image.Image] = []
    for directory in args.frames:
        paths = sorted(directory.glob("*.png"))
        if len(paths) < 2:
            raise ValueError(f"preview requires at least two frames in {directory}")
        for path in paths[::stride]:
            image = Image.open(path).convert("RGBA")
            background = Image.new("RGBA", image.size, (246, 248, 252, 255))
            background.alpha_composite(image)
            frames.append(background.convert("RGB"))

    args.output.parent.mkdir(parents=True, exist_ok=True)
    duration = round(1000 * stride / args.source_fps)
    frames[0].save(
        args.output,
        save_all=True,
        append_images=frames[1:],
        duration=duration,
        loop=0,
        disposal=2,
        optimize=False,
    )


if __name__ == "__main__":
    main()
