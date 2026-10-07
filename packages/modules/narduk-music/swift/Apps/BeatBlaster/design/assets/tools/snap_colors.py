#!/usr/bin/env python3
"""Snap near-brand-colour pixels to the exact brand hex (removes the haze an image model leaves on flat fills).

usage: snap_colors.py --root KIT in.png out.png [--tol 26] [--only ink,lime,white]
The palette is `palette` in <KIT>/kit.json. Anti-aliased in-between pixels are left alone. Try --tol 30 for logos,
26 for illustrations. `kit.py derive` already snaps every derived raster when kit.json has a palette; use this to
look at what snapping does to one render.
"""
from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image

from lib import load_kit, need_palette, snap


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--root", type=Path, default=Path.cwd(), help="kit dir (default: cwd)")
    ap.add_argument("src")
    ap.add_argument("dst")
    ap.add_argument("--tol", type=float, default=26)
    ap.add_argument("--only", help="comma separated palette keys")
    a = ap.parse_args()
    pal = need_palette(load_kit(a.root), "snap_colors.py")
    snap(Image.open(a.src), pal, a.tol, a.only.split(",") if a.only else None).save(a.dst, optimize=True)
    print("wrote", a.dst)


if __name__ == "__main__":
    main()
