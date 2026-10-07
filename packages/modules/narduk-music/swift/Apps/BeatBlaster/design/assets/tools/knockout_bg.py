#!/usr/bin/env python3
"""Knock a flat background out of an image-model render -> clean RGBA (transparent variants, dark mode).

Only background pixels CONNECTED TO THE IMAGE BORDER go transparent, so white shapes inside
the artwork stay opaque. The anti-aliased fringe is decontaminated (colour taken from the
nearest solid pixel, alpha from the blend with the background), so there is no white halo
when the result sits on a dark page.

usage: knockout_bg.py in.png out.png [--bg #FFFFFF] [--tol 30] [--fringe 2] [--global]
       --bg auto-detects from the four corners when omitted. Snap colours first (kit.py derive does).
"""
from __future__ import annotations

import argparse

import numpy as np
from PIL import Image
from scipy import ndimage

from lib import die, hex_rgb


def knockout(im: Image.Image, bg=None, tol: float = 30, fringe: int = 2, global_: bool = False) -> Image.Image:
    a = np.asarray(im.convert("RGB")).astype(np.float32)
    if bg is None:
        h, w = a.shape[:2]
        k = max(2, min(h, w) // 100)
        corners = np.concatenate([a[:k, :k].reshape(-1, 3), a[:k, -k:].reshape(-1, 3),
                                  a[-k:, :k].reshape(-1, 3), a[-k:, -k:].reshape(-1, 3)])
        bg = np.median(corners, axis=0)
    bg = np.array(bg, dtype=np.float32)
    d = np.sqrt(((a - bg) ** 2).sum(-1))
    bgmask = d <= tol
    if global_:
        region = bgmask
    else:
        lab, _ = ndimage.label(bgmask)
        border = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
        region = np.isin(lab, border[border > 0])
    fr = ndimage.binary_dilation(region, iterations=max(1, fringe)) & ~region
    solid = ~(region | fr)
    if not solid.any():
        die("knockout removed everything: nothing but background found (check --bg / --tol)")
    idx = ndimage.distance_transform_edt(~solid, return_distances=False, return_indices=True)
    fg = a[idx[0], idx[1]]
    diff = fg - bg
    denom = (diff ** 2).sum(-1)
    proj = ((a - bg) * diff).sum(-1) / np.maximum(denom, 1e-6)
    alpha_fr = np.where(denom < 40 ** 2, 1.0, np.clip(proj, 0, 1))
    alpha = np.where(region, 0.0, np.where(fr, alpha_fr, 1.0))
    rgb = np.where(fr[..., None], fg, a)
    rgb = np.where(region[..., None], bg, rgb)
    return Image.fromarray(np.dstack([rgb, alpha * 255]).round().astype(np.uint8), "RGBA")


def swap_colours(im: Image.Image, pairs, palette: dict, tol: float = 60) -> Image.Image:
    """Dark-mode recolour of a knocked-out image: swap palette colour pairs (e.g. ink <-> white)."""
    a = np.asarray(im.convert("RGBA")).copy()
    rgb = a[..., :3].astype(np.int32)
    out = rgb.copy()
    for x, y in pairs:
        cx, cy = np.array(palette[x]), np.array(palette[y])
        mx = np.sqrt(((rgb - cx) ** 2).sum(-1)) <= tol
        my = np.sqrt(((rgb - cy) ** 2).sum(-1)) <= tol
        out[mx & ~my] = cy
        out[my & ~mx] = cx
    a[..., :3] = out.astype(np.uint8)
    return Image.fromarray(a, "RGBA")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("src")
    ap.add_argument("dst")
    ap.add_argument("--bg", help="background hex; default: median of the corners")
    ap.add_argument("--tol", type=float, default=30)
    ap.add_argument("--fringe", type=int, default=2)
    ap.add_argument("--global", dest="global_", action="store_true",
                    help="also remove enclosed background-coloured islands (default: border-connected only)")
    a = ap.parse_args()
    knockout(Image.open(a.src), hex_rgb(a.bg) if a.bg else None, a.tol, a.fringe, a.global_).save(a.dst, optimize=True)
    print("wrote", a.dst)


if __name__ == "__main__":
    main()
