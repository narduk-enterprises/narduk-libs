#!/usr/bin/env python3
"""potrace helpers: bool mask -> SVG path data in a chosen coordinate box."""
from __future__ import annotations

import os
import re
import shutil
import subprocess
import tempfile

import numpy as np
from PIL import Image


def trace(mask: np.ndarray, up: int = 4):
    """potrace a bool mask (True = ink). Returns (path d in potrace units, width px, height px)."""
    if not shutil.which("potrace"):
        raise SystemExit("error: potrace missing (brew install potrace)")
    im = Image.fromarray((~mask * 255).astype(np.uint8))
    im = im.resize((im.width * up, im.height * up), Image.LANCZOS)
    im = im.point(lambda v: 255 if v > 128 else 0)
    with tempfile.TemporaryDirectory() as t:
        pbm, svg = os.path.join(t, "a.pbm"), os.path.join(t, "a.svg")
        im.convert("1").save(pbm)
        subprocess.run(["potrace", "-s", "-o", svg, "--turdsize", "8", "--alphamax", "1.1",
                        "--opttolerance", "0.4", "-u", "10", pbm], check=True)
        with open(svg) as fh:
            s = fh.read()
    return " ".join(re.findall(r'<path d="([^"]+)"', s)), im.width, im.height


def path_to_abs(d: str, w: int, h: int, scale: float, ox: float, oy: float) -> str:
    """potrace path (1/10 px units, y up) -> absolute coordinates, y down, scaled and offset, 2 decimals."""
    toks = re.findall(r"[MmLlCcZz]|-?\d+(?:\.\d+)?", d)
    out, i, cmd, cx, cy = [], 0, None, 0.0, 0.0

    def P(x, y):
        return ((x / 10.0) * scale + ox, ((h * 10 - y) / 10.0) * scale + oy)

    while i < len(toks):
        t = toks[i]
        if t in "MmLlCcZz":
            cmd = t
            i += 1
            if cmd in "Zz":
                out.append("Z")
            continue
        n = {"M": 2, "m": 2, "L": 2, "l": 2, "C": 6, "c": 6}[cmd]
        v = [float(x) for x in toks[i:i + n]]
        i += n
        if cmd in "Mm":
            if cmd == "m":
                v = [cx + v[0], cy + v[1]]
            cx, cy = v
            x, y = P(*v)
            out.append(f"M{x:.2f} {y:.2f}")
            cmd = "L" if cmd == "M" else "l"
        elif cmd in "Ll":
            if cmd == "l":
                v = [cx + v[0], cy + v[1]]
            cx, cy = v
            x, y = P(*v)
            out.append(f"L{x:.2f} {y:.2f}")
        else:
            if cmd == "c":
                v = [cx + v[0], cy + v[1], cx + v[2], cy + v[3], cx + v[4], cy + v[5]]
            pts = [P(v[0], v[1]), P(v[2], v[3]), P(v[4], v[5])]
            cx, cy = v[4], v[5]
            out.append("C" + " ".join(f"{x:.2f} {y:.2f}" for x, y in pts))
    return "".join(out)


def mask_to_svgpath(mask: np.ndarray, size: float, up: int = 2) -> str:
    """Square bool mask -> path data in a 0..size box."""
    h, w = mask.shape
    d, tw, th = trace(mask, up=up)
    return path_to_abs(d, tw, th, size / (w * up), 0, 0)
