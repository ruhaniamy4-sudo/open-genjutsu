#!/usr/bin/env python3
"""Identity-lock character portrait pad/crop + subtle UnsharpMask sharpener."""

import argparse
from PIL import Image, ImageFilter, ImageOps


def prep_reference(input_path: str, output_path: str, width: int, height: int, mode: str) -> None:
    img = Image.open(input_path).convert("RGB")
    if mode == "crop":
        out = ImageOps.fit(img, (width, height), method=Image.Resampling.LANCZOS, centering=(0.5, 0.35))
    else:
        out = ImageOps.pad(img, (width, height), method=Image.Resampling.LANCZOS, color=(10, 11, 13))
    out = out.filter(ImageFilter.UnsharpMask(radius=1.4, percent=115, threshold=3))
    out.save(output_path, quality=96)
    print(f"Saved identity-locked portrait to {output_path} ({width}x{height}, mode={mode})")


def main() -> None:
    parser = argparse.ArgumentParser(description="KINETIX Character Portrait Prep")
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--width", type=int, default=1376)
    parser.add_argument("--height", type=int, default=768)
    parser.add_argument("--mode", choices=["pad", "crop"], default="crop")
    args = parser.parse_args()
    prep_reference(args.input, args.output, args.width, args.height, args.mode)


if __name__ == "__main__":
    main()
