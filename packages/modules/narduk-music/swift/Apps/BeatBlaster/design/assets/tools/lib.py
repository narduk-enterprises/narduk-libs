#!/usr/bin/env python3
"""Shared helpers for the asset-pack post-processing scripts: kit.json, colour snap, resize, SVG raster.

Nothing here draws art; it only post-processes renders an image model drew. Needs pillow and numpy; scipy and
scikit-image where a script says so. `kit.py` (keep, derive, check) stays pure Python and imports this lazily.
"""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image


def die(msg: str):
    sys.exit(f"error: {msg}")


def hex_rgb(h: str) -> tuple[int, int, int]:
    h = h.lstrip("#")
    if len(h) != 6:
        die(f"bad hex colour {h!r}")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))  # type: ignore[return-value]


def load_kit(root) -> dict:
    """Read <root>/kit.json and add `_root` and `_palette` ({role: (r, g, b)}). See SKILL.md for the schema."""
    root = Path(root).resolve()
    p = root / "kit.json"
    if not p.is_file():
        die(f"{p} not found; `kit.py keep` writes it")
    man = json.loads(p.read_text())
    man["_root"] = root
    man["_palette"] = {k: hex_rgb(v) for k, v in (man.get("palette") or {}).items()}
    return man


def need_palette(man: dict, what: str) -> dict:
    if not man["_palette"]:
        die(f"{what} needs a `palette` ({{role: \"#HEX\"}}) in kit.json")
    return man["_palette"]


def snap_tol(man: dict, kind: str = "default") -> float:
    t = man.get("snap_tol", {})
    return float(t.get(kind, t.get("default", 26)))


def load_rgb(path) -> Image.Image:
    return Image.open(path).convert("RGB")


# ---------- colour ----------
def snap(im: Image.Image, palette: dict, tol: float = 26, keys=None) -> Image.Image:
    """Snap pixels within tol (euclidean RGB) of a brand colour exactly onto it.
    Removes the faint haze an image model leaves on flat fills; anti-aliased in-betweens are untouched."""
    a = np.asarray(im.convert("RGB")).astype(np.int32)
    cols = np.array([palette[k] for k in (keys or palette)], dtype=np.int32)
    d = np.sqrt(((a[:, :, None, :] - cols[None, None, :, :]) ** 2).sum(-1))
    j, dm = d.argmin(-1), d.min(-1)
    out = a.copy()
    m = dm <= tol
    out[m] = cols[j[m]]
    return Image.fromarray(out.astype(np.uint8))


def near(arr: np.ndarray, rgb, tol: float) -> np.ndarray:
    return np.abs(arr.astype(np.int32) - np.array(rgb)).sum(-1) < tol


# ---------- resize ----------
def resize_rgba(im: Image.Image, size) -> Image.Image:
    """Lanczos resize in premultiplied alpha so transparent edges get no halo."""
    im = im.convert("RGBA")
    a = np.asarray(im).astype(np.float32)
    al = a[..., 3:4] / 255.0
    chans = [a[..., 0] * al[..., 0], a[..., 1] * al[..., 0], a[..., 2] * al[..., 0], a[..., 3]]
    res = [np.asarray(Image.fromarray(c, "F").resize(size, Image.LANCZOS)) for c in chans]
    alpha = np.clip(res[3], 0, 255)
    safe = np.maximum(alpha / 255.0, 1e-6)
    rgb = [np.clip(r / safe, 0, 255) for r in res[:3]]
    return Image.fromarray(np.dstack(rgb + [alpha]).round().astype(np.uint8), "RGBA")


def resize(im: Image.Image, size) -> Image.Image:
    size = (int(size[0]), int(size[1]))
    return resize_rgba(im, size) if im.mode == "RGBA" else im.convert("RGB").resize(size, Image.LANCZOS)


def square(im: Image.Image, n: int) -> Image.Image:
    return resize(im, (n, n))


def svg_to_png(svg: str, n: int, dst: Path, bg: str | None = None, height: int | None = None) -> None:
    if not shutil.which("rsvg-convert"):
        die("rsvg-convert missing (brew install librsvg)")
    cmd = ["rsvg-convert", "-w", str(n), "-h", str(height or n)] + (["-b", bg] if bg else []) + ["-o", str(dst)]
    subprocess.run(cmd, input=svg.encode(), check=True)
