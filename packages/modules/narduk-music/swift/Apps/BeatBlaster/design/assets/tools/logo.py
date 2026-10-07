#!/usr/bin/env python3
"""The vector logo, traced from the kept app icon: mark SVGs, favicon SVGs, favicon.ico, wordmark lockups.

Called by `kit.py derive` when kit.json has a `logo` block; runnable alone: logo.py --root <kit>
Nothing is drawn: the mark layers are traced (potrace) from the palette-snapped app icon, the favicon.ico is
rasterised from the vector favicon (never downsample the 1024 raster to 16: it leaves a halo), and the wordmark is the
traced mark plus the product name set in a real font (wordmark.py).

kit.json `logo` block (colours are `palette` roles):
  {"field": role of the app icon's ground (default: the palette role nearest its corner),
   "mark_fraction": 0.6 (mark share of the SVG), "view": 32, "tile_radius": 7, "small_mark": 0.78,
   "layers": [{"color": role found in the app icon, "tol": 90, "open": n, "largest_only": bool,
               "mark_fill": role, "favicon_fill": role, "dark_fill": role}, ...],
   "wordmark": {...}}       (optional; see wordmark.py)
Layer 0 is the mark; later layers are counters or accents. Give the app icon's counter a colour that differs from the
mark (white on lime) so it traces as its own layer, then read the traced SVGs back.
"""
from __future__ import annotations

import argparse
import json
import struct
import sys
from pathlib import Path

import numpy as np
from scipy import ndimage

from lib import die, load_kit, load_rgb, near, need_palette, square, svg_to_png
from trace_lib import mask_to_svgpath


def write_ico(pngs: dict[int, bytes], dest: Path) -> None:
    """Hand-written ICO with PNG-compressed entries, so each size is its own crisp raster."""
    sizes = sorted(pngs)
    head = struct.pack("<HHH", 0, 1, len(sizes))
    off = 6 + 16 * len(sizes)
    entries, blobs = b"", b""
    for n in sizes:
        entries += struct.pack("<BBBBHHII", n % 256, n % 256, 0, 0, 1, 32, len(pngs[n]), off + len(blobs))
        blobs += pngs[n]
    dest.write_bytes(head + entries + blobs)


def small_view(masks: list, view: float, side: int, small_mark: float) -> tuple[float, float, float]:
    """Centre and half-size (svg units) of the square viewBox for favicon-small.svg.

    `masks` are the cropped layer masks that are drawn in the favicon. The bbox is their UNION: sizing it from
    layer 0 alone crops a second layer (white candles plus a mint counter) off the 16/32 px favicon."""
    ys, xs = np.where(np.logical_or.reduce(masks))
    unit = view / side
    bx0, bx1, by0, by1 = xs.min() * unit, (xs.max() + 1) * unit, ys.min() * unit, (ys.max() + 1) * unit
    half = max(bx1 - bx0, by1 - by0) / 2 / small_mark
    return (bx0 + bx1) / 2, (by0 + by1) / 2, half


def field_role(lg: dict, pal: dict, A: np.ndarray) -> str:
    if lg.get("field"):
        if lg["field"] not in pal:
            die(f"logo.field {lg['field']!r} is not a palette role")
        return lg["field"]
    corner = A[2, 2]
    return min(pal, key=lambda k: int(np.abs(np.array(pal[k]) - corner).sum()))


def build(root: Path, man: dict, asset: dict, src: Path) -> None:
    """Trace `src` (the palette-snapped app icon) into out/. `man` is kit.json; `asset` the app-icon entry."""
    root = Path(root).resolve()
    kit = load_kit(root)
    lg = man.get("logo") or die("kit.json has no `logo` block")
    pal = need_palette(kit, "the logo")
    hexes = kit["palette"]
    layers = lg.get("layers") or die("logo.layers is empty: layer 0 is the mark")
    for l in layers:
        for key in ("color", "mark_fill", "favicon_fill", "dark_fill"):
            if l.get(key) and l[key] not in pal:
                die(f"logo layer {key} {l[key]!r} is not a palette role ({', '.join(pal)})")
    out = root / "out"
    (out / "logo").mkdir(parents=True, exist_ok=True)
    prim = square(load_rgb(src), 1024)
    A = np.asarray(prim).astype(np.int32)

    masks = [near(A, pal[l["color"]], l.get("tol", 90)) for l in layers]
    ys, xs = np.where(masks[0])
    if not len(ys):
        die(f"logo: no pixels near {layers[0]['color']} in the app icon; check logo.layers[0].color")
    frac = float(lg.get("mark_fraction", 0.60))
    side = int(max(ys.max() - ys.min(), xs.max() - xs.min()) / frac)
    cy, cx = (ys.min() + ys.max()) // 2, (xs.min() + xs.max()) // 2

    def crop(m):
        m = np.pad(m, side, constant_values=False)
        return m[cy + side - side // 2:cy + side + side // 2, cx + side - side // 2:cx + side + side // 2]

    view = float(lg.get("view", 32))
    paths = []
    for l, m in zip(layers, masks):
        m = crop(m)
        if l.get("open"):
            m = ndimage.binary_opening(m, iterations=int(l["open"]))
        if l.get("largest_only"):
            lab, n = ndimage.label(m)
            if n > 1:
                m = lab == (1 + int(np.argmax(ndimage.sum(m, lab, range(1, n + 1)))))
        paths.append(mask_to_svgpath(m, view, up=2))
    vs = f"{view:g}"
    ns = 'xmlns="http://www.w3.org/2000/svg"'
    field = hexes[field_role(lg, pal, A)]

    def layer_svg(key: str) -> str:
        return "".join(f'<path d="{p}" fill="{hexes[l[key]]}"/>' for l, p in zip(layers, paths) if l.get(key))

    radius = lg.get("tile_radius", 7)
    fav = (f'<svg {ns} viewBox="0 0 {vs} {vs}"><rect width="{vs}" height="{vs}" rx="{radius}" '
           f'fill="{field}"/>{layer_svg("favicon_fill")}</svg>\n')
    (out / "favicon.svg").write_text(fav)
    (out / "logo/mark.svg").write_text(f'<svg {ns} viewBox="0 0 {vs} {vs}">{layer_svg("mark_fill")}</svg>\n')
    if any(l.get("dark_fill") for l in layers):  # mark for dark grounds (e.g. lime mark, ink counter)
        (out / "logo/mark-on-dark.svg").write_text(f'<svg {ns} viewBox="0 0 {vs} {vs}">{layer_svg("dark_fill")}</svg>\n')
    (out / "logo/mark-currentColor.svg").write_text(
        f'<svg {ns} viewBox="0 0 {vs} {vs}" fill="currentColor"><path d="{paths[0]}"/></svg>\n')

    # Small-size favicon vector: the same tile, but the mark fills `small_mark` of it (default 0.78), so a 16 px render
    # keeps the check about 2 px wide instead of mush. Every layer drawn in the favicon sets the bbox.
    drawn = [crop(m) for i, (l, m) in enumerate(zip(layers, masks)) if i == 0 or l.get("favicon_fill")]
    ccx, ccy, half = small_view(drawn, view, side, float(lg.get("small_mark", 0.78)))
    small = (f'<svg {ns} viewBox="{ccx - half:.3f} {ccy - half:.3f} {2 * half:.3f} {2 * half:.3f}">'
             f'<rect x="{ccx - half:.3f}" y="{ccy - half:.3f}" width="{2 * half:.3f}" height="{2 * half:.3f}" '
             f'rx="{radius * 2 * half / view:.3f}" fill="{field}"/>{layer_svg("favicon_fill")}</svg>\n')
    (out / "favicon-small.svg").write_text(small)

    # favicon.ico, rasterised from the vector at native size (no raster downscale)
    blobs = {}
    for n in (16, 32, 48):
        tmp = out / f".favicon-{n}.png"
        svg_to_png(small if n <= 32 else fav, n, tmp)
        blobs[n] = tmp.read_bytes()
        tmp.unlink()
    write_ico(blobs, out / "favicon.ico")

    wm = lg.get("wordmark")
    if wm is not None:
        import wordmark
        wordmark.build(root, man)


def main() -> None:
    ap = argparse.ArgumentParser(description="Re-trace the vector logo: runs `kit.py derive` on the app icon.")
    ap.add_argument("--root", type=Path, default=Path.cwd(), help="kit dir (default: cwd)")
    a = ap.parse_args()
    man = json.loads((a.root / "kit.json").read_text())
    icon = next((x for x in man.get("assets", []) if x.get("kind") == "app-icon"), None)
    if not icon:
        die("keep an app-icon asset first")
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import kit
    kit.main(["derive", "--root", str(a.root), icon["name"]])


if __name__ == "__main__":
    main()
