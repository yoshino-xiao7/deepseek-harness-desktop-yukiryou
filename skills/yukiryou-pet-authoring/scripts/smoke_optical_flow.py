#!/usr/bin/env python3
"""Run a deterministic smoke test for the local optical-flow interpolator."""

from __future__ import annotations

import argparse
import json
import subprocess
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw


def make_keyframe(path: Path, x: int) -> None:
    image = Image.new("RGBA", (192, 208), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((x, 70, x + 48, 154), radius=12, fill=(43, 92, 220, 255))
    draw.ellipse((x + 12, 82, x + 22, 92), fill=(255, 255, 255, 255))
    draw.ellipse((x + 30, 82, x + 40, 92), fill=(255, 255, 255, 255))
    image.save(path)


def alpha_centroid_x(image: Image.Image) -> float:
    alpha = image.getchannel("A")
    weighted = 0
    total = 0
    for y in range(alpha.height):
        for x in range(alpha.width):
            value = alpha.getpixel((x, y))
            weighted += x * value
            total += value
    if total == 0:
        raise AssertionError("generated frame has no visible pixels")
    return weighted / total


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--binary", type=Path)
    parser.add_argument("--fixture-dir", type=Path)
    args = parser.parse_args()
    if args.fixture_dir is not None:
        args.fixture_dir.mkdir(parents=True)
        make_keyframe(args.fixture_dir / "0000.png", 36)
        make_keyframe(args.fixture_dir / "0001.png", 108)
        print(json.dumps({"status": "ready", "keyframes": 2}, sort_keys=True))
        return
    if args.binary is None:
        parser.error("--binary is required unless --fixture-dir is used")

    with tempfile.TemporaryDirectory(prefix="yukiryou-optical-flow-") as root_value:
        root = Path(root_value)
        inputs = root / "keyframes"
        outputs = root / "frames"
        atlas = root / "atlas.png"
        inputs.mkdir()
        make_keyframe(inputs / "0000.png", 36)
        make_keyframe(inputs / "0001.png", 108)

        completed = subprocess.run(
            [
                str(args.binary),
                f"--input={inputs}",
                f"--output={outputs}",
                "--frames=9",
                "--loop=false",
                f"--atlas={atlas}",
                "--columns=4",
            ],
            capture_output=True,
            text=True,
        )
        if completed.returncode != 0:
            raise AssertionError(completed.stderr.strip() or "interpolator failed")
        result = json.loads(completed.stdout)
        frames = sorted(outputs.glob("*.png"))
        if len(frames) != 9 or result.get("outputFrames") != 9:
            raise AssertionError("interpolator did not emit the requested frame count")
        atlas_image = Image.open(atlas)
        if atlas_image.size != (192 * 4, 208 * 3):
            raise AssertionError(f"unexpected atlas dimensions: {atlas_image.size}")

        images = [Image.open(path).convert("RGBA") for path in frames]
        if images[0].tobytes() != Image.open(inputs / "0000.png").convert("RGBA").tobytes():
            raise AssertionError("first output frame does not preserve the first keyframe")
        if images[-1].tobytes() != Image.open(inputs / "0001.png").convert("RGBA").tobytes():
            raise AssertionError("last output frame does not preserve the last keyframe")

        centroids = [alpha_centroid_x(image) for image in images]
        if not all(left < right for left, right in zip(centroids, centroids[1:])):
            raise AssertionError(f"motion is not monotonic: {centroids}")
        midpoint = centroids[len(centroids) // 2]
        expected_midpoint = (centroids[0] + centroids[-1]) / 2
        if abs(midpoint - expected_midpoint) > 8:
            raise AssertionError(
                f"midpoint drift is too large: actual={midpoint:.2f}, expected={expected_midpoint:.2f}"
            )

        print(json.dumps({
            "status": "passed",
            "engine": result.get("engine"),
            "frames": len(frames),
            "atlas": list(atlas_image.size),
            "centroidX": [round(value, 2) for value in centroids],
        }, sort_keys=True))


if __name__ == "__main__":
    main()
