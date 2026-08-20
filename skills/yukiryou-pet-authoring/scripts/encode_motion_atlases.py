#!/usr/bin/env python3
"""Encode generated PNG motion atlases as bounded high-quality WebP assets."""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

from PIL import Image, ImageChops


MOTIONS = (
    "standing",
    "drowsy",
    "lying-down",
    "sleeping",
    "waking",
    "rubbing-eyes",
    "work-enter",
    "eating",
    "work-exit",
)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--generated", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--quality", type=int, default=95)
    parser.add_argument("--frame-width", type=int)
    parser.add_argument("--frame-height", type=int)
    parser.add_argument("--source-fps", type=int, default=60)
    parser.add_argument("--target-fps", type=int, default=60)
    parser.add_argument("--png-motion", action="append", choices=MOTIONS, default=[])
    args = parser.parse_args()
    if not 80 <= args.quality <= 100:
        raise ValueError("quality must be between 80 and 100")
    if (args.frame_width is None) != (args.frame_height is None):
        raise ValueError("frame width and height must be supplied together")
    if args.frame_width is not None and not (64 <= args.frame_width <= 512 and 64 <= args.frame_height <= 512):
        raise ValueError("frame dimensions must be between 64 and 512")
    if args.source_fps < 1 or args.target_fps < 1 or args.target_fps > args.source_fps or args.source_fps % args.target_fps:
        raise ValueError("target fps must be an integer divisor of source fps")
    stride = args.source_fps // args.target_fps

    args.output.mkdir(parents=True, exist_ok=True)
    report: dict[str, object] = {"schemaVersion": 1, "quality": args.quality, "motions": {}}
    for motion in MOTIONS:
        evidence = json.loads((args.generated / f"{motion}.json").read_text())
        source = args.generated / evidence["atlas"]
        use_png = motion in args.png_motion
        target = args.output / f"{motion}.{'png' if use_png else 'webp'}"
        with Image.open(source) as image:
            source_rgba = image.convert("RGBA")
            source_width = evidence["synthesis"]["width"]
            source_height = evidence["synthesis"]["height"]
            frame_width = args.frame_width or source_width
            frame_height = args.frame_height or source_height
            selected_frames = list(range(0, evidence["frameCount"], stride))
            output_columns = min(12, len(selected_frames))
            output_rows = math.ceil(len(selected_frames) / output_columns)
            rgba = Image.new("RGBA", (frame_width * output_columns, frame_height * output_rows))
            for output_frame, source_frame in enumerate(selected_frames):
                source_column = source_frame % evidence["columns"]
                source_row = source_frame // evidence["columns"]
                cell = source_rgba.crop((
                    source_column * source_width,
                    source_row * source_height,
                    (source_column + 1) * source_width,
                    (source_row + 1) * source_height,
                ))
                if cell.size != (frame_width, frame_height):
                    cell = cell.resize((frame_width, frame_height), Image.Resampling.LANCZOS)
                output_column = output_frame % output_columns
                output_row = output_frame // output_columns
                rgba.alpha_composite(cell, (output_column * frame_width, output_row * frame_height))
            if use_png:
                rgba.save(target, "PNG", optimize=True)
            else:
                rgba.save(target, "WEBP", quality=args.quality, alpha_quality=100, method=4)
            with Image.open(target) as encoded:
                if encoded.size != rgba.size or "A" not in encoded.getbands():
                    raise ValueError(f"encoded atlas lost dimensions or alpha: {motion}")
                decoded = encoded.convert("RGBA")
                decoded_frame_width = decoded.width // output_columns
                decoded_frame_height = decoded.height // output_rows
                previous = None
                changed_pairs = 0
                for frame in range(len(selected_frames)):
                    column = frame % output_columns
                    row = frame // output_columns
                    cell = decoded.crop((
                        column * decoded_frame_width,
                        row * decoded_frame_height,
                        (column + 1) * decoded_frame_width,
                        (row + 1) * decoded_frame_height,
                    ))
                    if cell.getbbox() is None:
                        raise ValueError(f"encoded atlas contains an empty frame: {motion} {frame}")
                    if previous is not None and ImageChops.difference(previous, cell).getbbox() is not None:
                        changed_pairs += 1
                    previous = cell
                if changed_pairs != len(selected_frames) - 1:
                    raise ValueError(f"encoded atlas contains static adjacent frames: {motion}")
        report["motions"][motion] = {
            "sourceBytes": source.stat().st_size,
            "encodedBytes": target.stat().st_size,
            "path": target.name,
            "mediaType": "image/png" if use_png else "image/webp",
            "width": rgba.width,
            "height": rgba.height,
            "columns": output_columns,
            "rows": output_rows,
            "frameCount": len(selected_frames),
            "sourceFps": args.source_fps,
            "targetFps": args.target_fps,
            "changedAdjacentPairs": changed_pairs,
        }
    (args.output / "encoding-report.json").write_text(json.dumps(report, indent=2) + "\n")


if __name__ == "__main__":
    main()
