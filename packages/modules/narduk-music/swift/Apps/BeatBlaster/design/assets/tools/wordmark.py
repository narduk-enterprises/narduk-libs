#!/usr/bin/env python3
"""Wordmark lockups: the traced mark plus the product name set in a real font, all vector.

usage: wordmark.py --root <kit>    (called by logo.py after the mark is traced; needs out/logo/mark*.svg)
The image model never draws letters: the text is glyph outlines from a real font (fonttools + uharfbuzz for
kerning), converted to <path>, so the SVGs need no font at runtime. Writes <kit>/out/logo/:
  wordmark-{horizontal,stacked,text}-{light,dark}.svg  (text = the name only, no mark; transparent ground; light = ink text, dark = white text)
  wordmark-{horizontal,stacked,text}-{light,dark}.png  (transparent, `png_width` px wide)
kit.json `logo.wordmark` block (optional keys default as shown):
  {"text": "<kit name>", "font": (path relative to the kit; default is the cached
       ~/.cache/asset-pack/fonts/InstrumentSans[wdth,wght].ttf, outside the repo; if you set a path inside the
       repo, gitignore it or commit it on purpose),
   "font_url": "https://github.com/google/fonts/raw/main/ofl/instrumentsans/InstrumentSans%5Bwdth%2Cwght%5D.ttf"
       (fetched to the font path when it is missing), "weight": 700, "width": 100,
   "light": {"text": "ink"}, "dark": {"text": "white", "mark": "mark-on-dark.svg"},
   "mark_height": 1.0 (mark height as a multiple of the x-height-based text size), "gap": 0.32, "png_width": 2400}
Needs `pip install fonttools uharfbuzz` (macOS system python is PEP 668: use a venv with --system-site-packages).
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image

from lib import die, load_kit, svg_to_png

DEFAULT_FONT_URL = "https://github.com/google/fonts/raw/main/ofl/instrumentsans/InstrumentSans%5Bwdth%2Cwght%5D.ttf"


VENV_HELP = ("the wordmark step needs fonttools + uharfbuzz, and this python (%s) lacks them. Set up the kit venv and run "
             "kit.py derive with it: python3 -m venv --system-site-packages $KIT/.venv && "
             "$KIT/.venv/bin/pip install fonttools uharfbuzz && $KIT/.venv/bin/python $KIT/tools/kit.py derive --root $KIT "
             "(macOS system python is PEP 668, so plain pip refuses; see SKILL.md)")


def require_deps() -> None:
    """Die early, naming the venv recipe, when fonttools/uharfbuzz cannot be imported by this interpreter."""
    try:
        import fontTools  # noqa: F401
        import uharfbuzz  # noqa: F401
    except ImportError:
        die(VENV_HELP % sys.executable)


def font_cache_dir() -> Path:
    """Downloaded fonts live outside the repo (they are third-party binaries, not pack output)."""
    return Path(os.environ.get("XDG_CACHE_HOME") or Path.home() / ".cache") / "asset-pack" / "fonts"


def font_path(kit: dict, wm: dict) -> Path:
    """`font` (relative to the kit) when set; otherwise the default font cached in ~/.cache/asset-pack/fonts.
    A missing font is downloaded from `font_url`."""
    if wm.get("font"):
        p = (kit["_root"] / wm["font"]).resolve()
    else:
        p = font_cache_dir() / "InstrumentSans[wdth,wght].ttf"
    if not p.is_file():
        p.parent.mkdir(parents=True, exist_ok=True)
        try:
            urllib.request.urlretrieve(wm.get("font_url", DEFAULT_FONT_URL), p)
        except Exception as e:  # noqa: BLE001
            die(f"font {p} missing and download failed: {e}")
    return p


def shape_text(path: Path, text: str, weight: float, width: float):
    """-> (svg path d in y-down units of 1 em = 1000, ink bbox (x0, y0, x1, y1), x-height) for `text`."""
    try:
        import uharfbuzz as hb
        from fontTools.pens.svgPathPen import SVGPathPen
        from fontTools.pens.transformPen import TransformPen
        from fontTools.ttLib import TTFont
        from fontTools.varLib.instancer import instantiateVariableFont
    except ImportError:
        die(VENV_HELP % sys.executable)
    ft = TTFont(path)
    if "fvar" in ft:
        axes = {a.axisTag: a for a in ft["fvar"].axes}
        loc = {"wght": weight, **({"wdth": width} if "wdth" in axes else {})}
        ft = instantiateVariableFont(ft, loc, inplace=False)
    import io
    buf = io.BytesIO()
    ft.save(buf)
    data = buf.getvalue()
    upm = ft["head"].unitsPerEm
    scale = 1000 / upm
    face = hb.Face(data)
    font = hb.Font(face)
    b = hb.Buffer()
    b.add_str(text)
    b.guess_segment_properties()
    hb.shape(font, b, {"kern": True, "liga": False})
    gs = ft.getGlyphSet()
    order = ft.getGlyphOrder()
    d, x = "", 0
    for info, pos in zip(b.glyph_infos, b.glyph_positions):
        name = order[info.codepoint]
        pen = SVGPathPen(gs, ntos=lambda v: f"{v:.2f}".rstrip("0").rstrip("."))
        tp = TransformPen(pen, (scale, 0, 0, -scale, (x + pos.x_offset) * scale, 0))
        gs[name].draw(tp)
        d += pen.getCommands()
        x += pos.x_advance
    # ink bbox from the outlines (flip already applied): parse numbers pairwise is fragile, so measure by raster
    xh = getattr(ft["OS/2"], "sxHeight", 0) * scale or 500
    return d, x * scale, xh


def bbox_of_svg(svg: str, px: int = 1024) -> tuple[float, float, float, float]:
    """Ink bbox of an svg in its viewBox units, measured on a raster (no path parser needed)."""
    m = re.search(r'viewBox="([\d.\s-]+)"', svg)
    vx, vy, vw, vh = map(float, m.group(1).split())
    png = subprocess.run(["rsvg-convert", "-w", str(px), "-h", str(round(px * vh / vw))], input=svg.encode(),
                         capture_output=True, check=True).stdout
    import io
    a = np.asarray(Image.open(io.BytesIO(png)).convert("RGBA"))[..., 3] > 8
    ys, xs = np.where(a)
    if not len(xs):
        die("empty svg bbox")
    k = vw / a.shape[1]
    return vx + xs.min() * k, vy + ys.min() * k, vx + (xs.max() + 1) * k, vy + (ys.max() + 1) * k


def inner(svg: str) -> str:
    return re.sub(r"^.*?<svg[^>]*>|</svg>\s*$", "", svg.strip(), flags=re.S)


def build(root: Path, man: dict) -> None:
    kit = load_kit(root)
    wm = (man.get("logo") or {}).get("wordmark")
    if wm is None:
        return
    out = kit["_root"] / "out" / "logo"
    hexes = kit["palette"]
    text = wm.get("text", kit["name"])
    require_deps()
    fp = font_path(kit, wm)
    d, adv, xh = shape_text(fp, text, float(wm.get("weight", 700)), float(wm.get("width", 100)))
    ns = 'xmlns="http://www.w3.org/2000/svg"'
    gap_k, mh_k, pw = float(wm.get("gap", 0.32)), float(wm.get("mark_height", 1.0)), int(wm.get("png_width", 2400))
    # text bbox at font size 1000 (baseline y=0, ascenders negative)
    tb = bbox_of_svg(f'<svg {ns} viewBox="-100 -1200 {adv + 200:.1f} 1500"><path d="{d}"/></svg>', 2048)
    tx0, ty0, tx1, ty1 = tb
    for mode in ("light", "dark"):
        conf = {"light": {"text": "ink", "mark": "mark.svg"}, "dark": {"text": "white", "mark": "mark-on-dark.svg"},
                **{k: v for k, v in wm.items() if k in ("light", "dark")}}[mode]
        mfile = out / conf["mark"]
        if not mfile.is_file():
            print(f"wordmark: skip {mode}: {mfile.name} missing")
            continue
        msvg = mfile.read_text()
        mx0, my0, mx1, my1 = bbox_of_svg(msvg)
        mw, mh = mx1 - mx0, my1 - my0
        tcol = hexes[conf["text"]]
        text_h = ty1 - ty0
        # horizontal: mark height = mh_k * text height * 1.25 (mark reads a little larger than the ascender line)
        H = text_h * 1.25 * mh_k
        ms = H / mh
        gap = H * gap_k
        cy = 0.0
        # centre the x-height band of the text on the mark's centre
        base = cy + xh / 2
        w = mw * ms + gap + (tx1 - tx0)
        vx0, vy0 = 0, -H / 2
        pad = H * 0.04
        hor = (f'<svg {ns} viewBox="{-pad:.1f} {vy0 - pad:.1f} {w + 2 * pad:.1f} {H + 2 * pad:.1f}" role="img" '
               f'aria-label="{text}"><g transform="translate({-mx0 * ms:.3f} {-H / 2 - my0 * ms:.3f}) scale({ms:.5f})">'
               f'{inner(msvg)}</g><path fill="{tcol}" transform="translate({mw * ms + gap - tx0:.2f} {base:.2f})" '
               f'd="{d}"/></svg>\n')
        # text may exceed mark vertically if ascenders are tall: fit the viewBox to the union
        hb0 = min(-H / 2, base + ty0)
        hb1 = max(H / 2, base + ty1)
        hor = re.sub(r'viewBox="[^"]+"', f'viewBox="{-pad:.1f} {hb0 - pad:.1f} {w + 2 * pad:.1f} {hb1 - hb0 + 2 * pad:.1f}"', hor, count=1)
        # stacked: mark centred above the text; mark height = 2.7 x the text height (width capped at 55% of the text)
        ms2 = min(2.7 * text_h / mh, 0.55 * (tx1 - tx0) / mw)
        S, H2 = mw * ms2, mh * ms2
        gap2 = H2 * 0.22
        tw = tx1 - tx0
        W2 = max(tw, S)
        stk = (f'<svg {ns} viewBox="{-pad:.1f} {-pad:.1f} {W2 + 2 * pad:.1f} {H2 + gap2 + text_h + 2 * pad:.1f}" role="img" '
               f'aria-label="{text}"><g transform="translate({(W2 - S) / 2 - mx0 * ms2:.3f} {-my0 * ms2:.3f}) scale({ms2:.5f})">'
               f'{inner(msvg)}</g><path fill="{tcol}" transform="translate({(W2 - tw) / 2 - tx0:.2f} {H2 + gap2 - ty0:.2f})" '
               f'd="{d}"/></svg>\n')
        tw0 = tx1 - tx0
        txt = (f'<svg {ns} viewBox="{-pad:.1f} {ty0 - pad:.1f} {tw0 + 2 * pad:.1f} {text_h + 2 * pad:.1f}" role="img" '
               f'aria-label="{text}"><path fill="{tcol}" transform="translate({-tx0:.2f} 0)" d="{d}"/></svg>\n')
        for kind, svg in (("horizontal", hor), ("stacked", stk), ("text", txt)):
            name = f"logo/wordmark-{kind}-{mode}"
            (kit["_root"] / "out" / f"{name}.svg").write_text(svg)
            vb = list(map(float, re.search(r'viewBox="([^"]+)"', svg).group(1).split()))
            svg_to_png(svg, pw if kind != "stacked" else pw // 2, kit["_root"] / "out" / f"{name}.png",
                       height=round((pw if kind != "stacked" else pw // 2) * vb[3] / vb[2]))


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--root", type=Path, default=Path.cwd(), help="kit dir (default: cwd)")
    a = ap.parse_args()
    build(a.root, json.loads((a.root / "kit.json").read_text()))
    print("wrote", a.root / "out/logo")
