#!/usr/bin/env python3
"""Remove detached optical-flow debris without altering the main character shapes."""

from __future__ import annotations

import argparse
import json
from collections import deque
from pathlib import Path

from PIL import Image


NEIGHBORS = (
    (-1, -1), (0, -1), (1, -1),
    (-1, 0),           (1, 0),
    (-1, 1),  (0, 1),  (1, 1),
)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--alpha-threshold", type=int, default=8)
    parser.add_argument("--minimum-component", type=int, default=48)
    parser.add_argument("--minimum-ratio", type=float, default=0.004)
    args = parser.parse_args()
    paths = sorted(args.input.glob("*.png"))
    if len(paths) < 2:
        raise ValueError("dense frame directory requires at least two PNG files")
    args.output.mkdir(parents=True, exist_ok=False)

    removed_components = 0
    removed_pixels = 0
    for path in paths:
        image = Image.open(path).convert("RGBA")
        width, height = image.size
        pixels = list(image.getdata())
        visible = [pixel[3] > args.alpha_threshold for pixel in pixels]
        visited = bytearray(width * height)
        components: list[list[int]] = []
        for start, is_visible in enumerate(visible):
            if not is_visible or visited[start]:
                continue
            visited[start] = 1
            queue = deque([start])
            component: list[int] = []
            while queue:
                index = queue.popleft()
                component.append(index)
                x = index % width
                y = index // width
                for dx, dy in NEIGHBORS:
                    nx = x + dx
                    ny = y + dy
                    if nx < 0 or ny < 0 or nx >= width or ny >= height:
                        continue
                    neighbor = ny * width + nx
                    if visible[neighbor] and not visited[neighbor]:
                        visited[neighbor] = 1
                        queue.append(neighbor)
            components.append(component)

        largest = max((len(component) for component in components), default=0)
        minimum = max(args.minimum_component, round(largest * args.minimum_ratio))
        rejected = [component for component in components if len(component) < minimum]
        for component in rejected:
            removed_components += 1
            removed_pixels += len(component)
            for index in component:
                pixels[index] = (0, 0, 0, 0)
        image.putdata(pixels)
        image.save(args.output / path.name, optimize=True)

    print(json.dumps({
        "status": "complete",
        "frames": len(paths),
        "removedComponents": removed_components,
        "removedPixels": removed_pixels,
    }, sort_keys=True))


if __name__ == "__main__":
    main()
