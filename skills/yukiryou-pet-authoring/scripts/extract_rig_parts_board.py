#!/usr/bin/env python3
"""Deterministically remove a bright neutral board and crop declared rig parts."""

from __future__ import annotations

import argparse
import json
from collections import deque
from pathlib import Path

from PIL import Image


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--regions", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--evidence", required=True, type=Path)
    return parser.parse_args()


def is_background_candidate(pixel: tuple[int, int, int, int]) -> bool:
    red, green, blue, _alpha = pixel
    return min(red, green, blue) >= 232 and max(red, green, blue) - min(red, green, blue) <= 14


def edge_background_mask(image: Image.Image) -> bytearray:
    width, height = image.size
    pixels = image.load()
    mask = bytearray(width * height)
    queue: deque[tuple[int, int]] = deque()
    for x in range(width):
        queue.append((x, 0))
        queue.append((x, height - 1))
    for y in range(height):
        queue.append((0, y))
        queue.append((width - 1, y))
    while queue:
        x, y = queue.popleft()
        index = y * width + x
        if mask[index] or not is_background_candidate(pixels[x, y]):
            continue
        mask[index] = 1
        if x > 0:
            queue.append((x - 1, y))
        if x + 1 < width:
            queue.append((x + 1, y))
        if y > 0:
            queue.append((x, y - 1))
        if y + 1 < height:
            queue.append((x, y + 1))
    return mask


def transparent_board(image: Image.Image, mask: bytearray) -> Image.Image:
    output = image.copy()
    pixels = output.load()
    width, height = output.size
    for y in range(height):
        for x in range(width):
            if mask[y * width + x]:
                red, green, blue, _alpha = pixels[x, y]
                pixels[x, y] = (red, green, blue, 0)
    return output


def retain_largest_component(image: Image.Image) -> Image.Image:
    width, height = image.size
    alpha = image.getchannel("A")
    values = alpha.load()
    visited = bytearray(width * height)
    largest: list[tuple[int, int]] = []
    for start_y in range(height):
        for start_x in range(width):
            start_index = start_y * width + start_x
            if visited[start_index] or values[start_x, start_y] == 0:
                continue
            queue: deque[tuple[int, int]] = deque([(start_x, start_y)])
            visited[start_index] = 1
            component: list[tuple[int, int]] = []
            while queue:
                x, y = queue.popleft()
                component.append((x, y))
                for next_y in range(max(0, y - 1), min(height, y + 2)):
                    for next_x in range(max(0, x - 1), min(width, x + 2)):
                        index = next_y * width + next_x
                        if not visited[index] and values[next_x, next_y] > 0:
                            visited[index] = 1
                            queue.append((next_x, next_y))
            if len(component) > len(largest):
                largest = component
    if not largest:
        return image
    keep = set(largest)
    output = image.copy()
    pixels = output.load()
    for y in range(height):
        for x in range(width):
            if (x, y) not in keep:
                red, green, blue, _alpha = pixels[x, y]
                pixels[x, y] = (red, green, blue, 0)
    return output


def main() -> None:
    args = parse_args()
    image = Image.open(args.input).convert("RGBA")
    regions = json.loads(args.regions.read_text(encoding="utf-8"))
    if not isinstance(regions, dict) or not regions:
        raise ValueError("regions must be a non-empty object")
    mask = edge_background_mask(image)
    board = transparent_board(image, mask)
    args.output_dir.mkdir(parents=True, exist_ok=True)
    outputs: list[dict[str, object]] = []
    for part_id, bounds in regions.items():
        if (
            not isinstance(part_id, str)
            or not isinstance(bounds, list)
            or len(bounds) != 4
            or not all(isinstance(value, int) for value in bounds)
        ):
            raise ValueError(f"invalid region: {part_id}")
        left, top, right, bottom = bounds
        if left < 0 or top < 0 or right > image.width or bottom > image.height or left >= right or top >= bottom:
            raise ValueError(f"out-of-bounds region: {part_id}")
        crop = retain_largest_component(board.crop((left, top, right, bottom)))
        alpha_bounds = crop.getchannel("A").getbbox()
        if alpha_bounds is None:
            raise ValueError(f"empty part: {part_id}")
        alpha_bounds = (
            max(0, alpha_bounds[0] - 4),
            max(0, alpha_bounds[1] - 4),
            min(crop.width, alpha_bounds[2] + 4),
            min(crop.height, alpha_bounds[3] + 4),
        )
        crop = crop.crop(alpha_bounds)
        path = args.output_dir / f"{part_id}.png"
        crop.save(path, format="PNG", optimize=True)
        alpha = crop.getchannel("A")
        outputs.append({
            "id": part_id,
            "path": path.name,
            "width": crop.width,
            "height": crop.height,
            "opaquePixels": sum(count for count, value in (alpha.getcolors(maxcolors=256) or []) if value > 0),
        })
    args.evidence.parent.mkdir(parents=True, exist_ok=True)
    args.evidence.write_text(json.dumps({
        "schemaVersion": 1,
        "extractor": "edge-neutral-flood-v1",
        "source": args.input.name,
        "sourceWidth": image.width,
        "sourceHeight": image.height,
        "parts": outputs,
    }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
