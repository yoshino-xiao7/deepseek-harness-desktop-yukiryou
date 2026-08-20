#!/usr/bin/env python3
"""Render deterministic key-pose QA thumbnails from a layered-rig declaration."""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

from PIL import Image, ImageDraw


def args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--rig", required=True, type=Path)
    parser.add_argument("--parts-dir", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    return parser.parse_args()


def transformed(part: Image.Image, node: dict, transform: dict, canvas: tuple[int, int]) -> Image.Image:
    pivot_x = node["pivot"]["x"] * part.width
    pivot_y = node["pivot"]["y"] * part.height
    cosine = math.cos(transform["rotation"])
    sine = math.sin(transform["rotation"])
    a = cosine * transform["scaleX"]
    b = -sine * transform["scaleY"]
    d = sine * transform["scaleX"]
    e = cosine * transform["scaleY"]
    c = transform["x"] - a * pivot_x - b * pivot_y
    f = transform["y"] - d * pivot_x - e * pivot_y
    determinant = a * e - b * d
    inverse = (e / determinant, -b / determinant, (b * f - e * c) / determinant,
               -d / determinant, a / determinant, (d * c - a * f) / determinant)
    layer = part.transform(canvas, Image.Transform.AFFINE, inverse, Image.Resampling.BICUBIC)
    if transform["opacity"] < 1:
        alpha = layer.getchannel("A").point(lambda value: round(value * transform["opacity"]))
        layer.putalpha(alpha)
    return layer


def main() -> None:
    options = args()
    rig = json.loads(options.rig.read_text(encoding="utf-8"))
    canvas_size = (rig["canvas"]["width"], rig["canvas"]["height"])
    assets = {asset["id"]: Image.open(options.parts_dir / Path(asset["path"]).name).convert("RGBA") for asset in rig["assets"]}
    nodes = sorted(rig["nodes"], key=lambda node: node["zIndex"])
    selections = {
        "standing": 0, "drowsy": -1, "lying-down": -1, "sleeping": 1,
        "waking": -1, "rubbing-eyes": 1, "work-enter": -1, "eating": 1, "work-exit": -1,
    }
    scale = 3
    label_height = 24
    sheet = Image.new("RGBA", (canvas_size[0] * scale * 3, (canvas_size[1] * scale + label_height) * 3), (244, 246, 250, 255))
    draw = ImageDraw.Draw(sheet)
    for index, (motion, key_index) in enumerate(selections.items()):
        pose = {track["nodeId"]: track["keyframes"][key_index]["transform"] for track in rig["motions"][motion]["tracks"]}
        frame = Image.new("RGBA", canvas_size, (0, 0, 0, 0))
        for node in nodes:
            layer = transformed(assets[node["assetId"]], node, pose[node["id"]], canvas_size)
            frame.alpha_composite(layer)
        frame = frame.resize((canvas_size[0] * scale, canvas_size[1] * scale), Image.Resampling.NEAREST)
        column = index % 3
        row = index // 3
        x = column * canvas_size[0] * scale
        y = row * (canvas_size[1] * scale + label_height)
        sheet.alpha_composite(frame, (x, y))
        draw.text((x + 8, y + canvas_size[1] * scale + 4), motion, fill=(31, 36, 48, 255))
    options.output.parent.mkdir(parents=True, exist_ok=True)
    sheet.convert("RGB").save(options.output, quality=94)


if __name__ == "__main__":
    main()
