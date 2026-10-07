#!/usr/bin/env python3
"""Slice an icon sheet (black strokes on white, one sheet drawn by the image model) into one crop per icon.

usage: slice_sheet.py sheet.png --rows 3 --cols 4 [--out DIR]
       slice_sheet.py sheet.png --rows 3 --cols 4 --root <kit> --names a,b,c,... --category C
                      [--backend sol] [--model M] (--prompt-file F | --prompt-index raw/index.md) [--round N]
Exits 1 if the sheet does not slice into exactly rows x cols icons (a merged, missing or
clipped icon means: regenerate the sheet, do not patch it). With --out, writes cell PNGs
(cell-01.png ... row-major) and preview.png so you can eyeball the order first.
With --root, keeps the sheet under <kit>/icons/sheets/ and each cell as <kit>/icons/raw/<name>.png, and records every
icon (the sheet's exact prompt, backend, tool and `sheet`) in icons/manifest.json. --names is row-major; `-` skips a
cell. trace.py then traces icons/raw like any other render, so a sheet-drawn icon and a one-per-render icon share one
tracer and one gate.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
from PIL import Image


class SheetError(Exception):
    pass


def bands(profile: np.ndarray, n: int):
    """Split a 1D ink profile into n runs separated by the widest empty gaps."""
    idx = np.where(profile > 0)[0]
    if len(idx) == 0:
        raise SheetError("no ink found (is the sheet black-on-white?)")
    runs, start, prev = [], idx[0], idx[0]
    for i in idx[1:]:
        if i - prev > 1:
            runs.append((start, prev))
            start = i
        prev = i
    runs.append((start, prev))
    if len(runs) < n:
        raise SheetError(f"found only {len(runs)} separated groups, expected {n}: icons touch or merge")
    while len(runs) > n:
        gaps = [runs[i + 1][0] - runs[i][1] for i in range(len(runs) - 1)]
        k = int(np.argmin(gaps))
        runs[k:k + 2] = [(runs[k][0], runs[k + 1][1])]
    return runs


def slice_sheet(path, rows: int, cols: int, pad: int = 3):
    """Return row-major list of float ink arrays (1 = full ink) cropped to each icon plus pad."""
    im = Image.open(path).convert("L")
    ink = 1.0 - np.asarray(im, dtype=np.float32) / 255.0
    a = ink > 0.45
    out = []
    for (r0, r1) in bands(a.sum(1), rows):
        band = a[r0:r1 + 1]
        for (c0, c1) in bands(band.sum(0), cols):
            cell = a[r0:r1 + 1, c0:c1 + 1]
            ys, xs = np.where(cell)
            y0, y1, x0, x1 = ys.min(), ys.max(), xs.min(), xs.max()
            out.append(ink[max(0, r0 + y0 - pad):r0 + y1 + 1 + pad, max(0, c0 + x0 - pad):c0 + x1 + 1 + pad])
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("sheet")
    ap.add_argument("--rows", type=int, required=True)
    ap.add_argument("--cols", type=int, default=4)
    ap.add_argument("--out")
    ap.add_argument("--root", type=Path, help="kit dir: keep the sheet and its cells as icons")
    ap.add_argument("--names", help="comma separated, row-major; '-' skips a cell")
    ap.add_argument("--category")
    ap.add_argument("--backend", default="sol")
    ap.add_argument("--tool")
    ap.add_argument("--model")
    ap.add_argument("--prompt")
    ap.add_argument("--prompt-file", type=Path)
    ap.add_argument("--prompt-index", type=Path)
    ap.add_argument("--round", type=int, default=1)
    a = ap.parse_args()
    try:
        cells = slice_sheet(a.sheet, a.rows, a.cols)
    except SheetError as e:
        sys.exit(f"SLICE FAILED {a.sheet}: {e}")
    print(f"{a.sheet}: {len(cells)} icons ({a.rows}x{a.cols}); sizes " +
          ", ".join(f"{c.shape[1]}x{c.shape[0]}" for c in cells))
    if a.out:
        out = Path(a.out)
        out.mkdir(parents=True, exist_ok=True)
        tile = 200
        prev = Image.new("L", (a.cols * tile, a.rows * tile), 255)
        for i, c in enumerate(cells):
            im = Image.fromarray(((1 - c) * 255).astype(np.uint8))
            im.save(out / f"cell-{i + 1:02d}.png")
            t = im.copy()
            t.thumbnail((tile - 16, tile - 16))
            prev.paste(t, ((i % a.cols) * tile + 8, (i // a.cols) * tile + 8))
        prev.save(out / "preview.png")
        print("wrote", out)
    if a.root:
        keep_cells(a, cells)


def keep_cells(a, cells) -> None:
    here = str(Path(__file__).resolve().parent)
    if here not in sys.path:
        sys.path.insert(0, here)
    import kit
    names = [n.strip() for n in (a.names or "").split(",")]
    if len(names) != len(cells):
        sys.exit(f"--names has {len(names)} entries but the sheet has {a.rows}x{a.cols} = {len(cells)} cells")
    if not a.category:
        sys.exit("--root needs --category")
    sheet_name = Path(a.sheet).stem
    if a.prompt_index:
        prompt = kit.parse_index_prompts(a.prompt_index).get(Path(a.sheet).name, "").strip()
    else:
        prompt = (a.prompt_file.read_text() if a.prompt_file else a.prompt or "").strip()
    if not prompt:
        sys.exit("the sheet's exact prompt is required (--prompt, --prompt-file or --prompt-index)")
    entry = kit.drawing_entry(a.backend, a.tool, a.model, prompt, a.round, None)
    problems = kit.provenance.problems(entry)
    if problems:
        sys.exit(f"--backend {a.backend}: {'; '.join(problems)}")
    icons = a.root / "icons"
    (icons / "sheets").mkdir(parents=True, exist_ok=True)
    (icons / "raw").mkdir(exist_ok=True)
    Image.open(a.sheet).convert("RGB").save(icons / "sheets" / f"{sheet_name}.png")
    kept = 0
    for name, c in zip(names, cells):
        if name == "-":
            continue
        if not kit.KEBAB.fullmatch(name):
            sys.exit(f"{name}: icon names are kebab-case")
        Image.fromarray(((1 - c) * 255).astype(np.uint8)).save(icons / "raw" / f"{name}.png")
        kit.record(a.root, name, "icon", {**entry, "sheet": sheet_name},
                   {"category": a.category, "label": name.replace("-", " ").title(),
                    "keywords": [k for k in name.split("-") if k] + [name]})
        kept += 1
    print(f"kept {kept} icons from {sheet_name} into {icons}/raw (sheet kept in {icons}/sheets)")


if __name__ == "__main__":
    main()
