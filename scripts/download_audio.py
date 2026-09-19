#!/usr/bin/env python3
"""Download an audio stream to a local MP3 file.

Usage:
    python3 scripts/download_audio.py
    python3 scripts/download_audio.py -o lesson-audio.mp3
    python3 scripts/download_audio.py 'https://example.com/audio.mp3' -o audio.mp3
"""

from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path
from urllib.request import Request, urlopen


DEFAULT_URL = (
    ""
)


def main() -> int:
    parser = argparse.ArgumentParser(description="Download an MP3 audio stream.")
    parser.add_argument("url", nargs="?", default=DEFAULT_URL, help="audio URL")
    parser.add_argument("-o", "--output", type=Path, default=Path("downloaded-audio.mp3"))
    args = parser.parse_args()

    if args.output.exists():
        parser.error(f"refusing to overwrite existing file: {args.output}")

    request = Request(args.url, headers={"User-Agent": "Mozilla/5.0"})
    try:
        with urlopen(request, timeout=60) as response, args.output.open("xb") as destination:
            total = response.headers.get("Content-Length")
            print(f"Downloading to {args.output}...", file=sys.stderr)
            shutil.copyfileobj(response, destination, length=1024 * 1024)
    except Exception as error:
        args.output.unlink(missing_ok=True)
        print(f"Download failed: {error}", file=sys.stderr)
        return 1

    size = args.output.stat().st_size
    total_text = f" ({int(total):,} bytes expected)" if total and total.isdigit() else ""
    print(f"Saved {size:,} bytes to {args.output}{total_text}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
