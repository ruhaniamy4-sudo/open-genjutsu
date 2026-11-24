#!/usr/bin/env python3
"""Zero-loss FFmpeg video chunker & merger for KINETIX Studio (L4 5s / A100 8s)."""

import argparse
import os
import subprocess
import sys
from pathlib import Path


def split_video(input_path: str, target: str, output_dir: str) -> None:
    duration = 5 if target == "l4" else 8
    os.makedirs(output_dir, exist_ok=True)
    stem = Path(input_path).stem
    out_pattern = os.path.join(output_dir, f"{stem}_chunk_%03d.mp4")
    cmd = [
        "ffmpeg", "-y", "-i", input_path,
        "-c:v", "libx264", "-crf", "15", "-preset", "slow", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "256k",
        "-f", "segment", "-segment_time", str(duration), "-reset_timestamps", "1",
        out_pattern,
    ]
    print("Running:", " ".join(cmd))
    subprocess.run(cmd, check=True)


def merge_videos(input_dir: str, output_path: str) -> None:
    chunks = sorted(Path(input_dir).glob("*.mp4"))
    if not chunks:
        print(f"No MP4 chunks found in {input_dir}", file=sys.stderr)
        sys.exit(1)
    list_file = Path(input_dir) / "_concat_list.txt"
    with open(list_file, "w", encoding="utf-8") as f:
        for c in chunks:
            f.write(f"file '{c.resolve()}'\n")
    cmd = [
        "ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(list_file),
        "-c:v", "libx264", "-crf", "15", "-preset", "slow", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "256k",
        output_path,
    ]
    print("Running:", " ".join(cmd))
    subprocess.run(cmd, check=True)
    list_file.unlink(missing_ok=True)


def main() -> None:
    parser = argparse.ArgumentParser(description="KINETIX Zero-Loss FFmpeg Chunker & Merger")
    parser.add_argument("--input", required=True, help="Input video file (split) or folder of MP4 chunks (merge)")
    parser.add_argument("--output", default="./chunks", help="Output folder (split) or merged MP4 path (merge)")
    parser.add_argument("--target", choices=["l4", "a100"], default="a100", help="l4=5s chunks, a100=8s chunks")
    parser.add_argument("--merge", action="store_true", help="Concatenate rendered chunks into a final MP4")
    args = parser.parse_args()
    if args.merge:
        merge_videos(args.input, args.output)
    else:
        split_video(args.input, args.target, args.output)


if __name__ == "__main__":
    main()
