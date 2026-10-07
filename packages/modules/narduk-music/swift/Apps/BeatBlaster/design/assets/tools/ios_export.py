#!/usr/bin/env python3
"""Export kept renders as iOS image sets: <kit>/ios/Images.xcassets/<name>.imageset/ with 1x, 2x and 3x PNGs.

usage: ios_export.py --root <kit>

Nothing is drawn. Full-colour icons (icons/raw/<name>.png, renders on a flat ground) get that ground knocked out
(knockout_bg.knockout, including enclosed islands), are trimmed to a square and resized to 96/192/288 px, shipped as
`icon-<name>`. Vibe cards and other raw/<name>.png illustrations stay opaque and ship at 320/640/960 px. The app icon
ships as out/app-icon-1024.png (derive). Run `kit.py derive` first for that.
"""
from __future__ import annotations

import argparse
import json
import pathlib

from PIL import Image

from knockout_bg import knockout

CROP = 10
KEEP_ISLANDS = {'kit-zappy'}  # dark disc interior must stay: border-connected knock-out only


def write_set(dest: pathlib.Path, name: str, im: Image.Image, base: int) -> None:
    d = dest / f'{name}.imageset'
    d.mkdir(parents=True, exist_ok=True)
    images = []
    for scale, suffix in ((1, ''), (2, '@2x'), (3, '@3x')):
        px = base * scale
        fn = f'{name}{suffix}.png'
        im.resize((px, px), Image.LANCZOS).save(d / fn, optimize=True)
        images.append({'idiom': 'universal', 'filename': fn, 'scale': f'{scale}x'})
    (d / 'Contents.json').write_text(json.dumps({'images': images, 'info': {'author': 'xcode', 'version': 1}}, indent=2) + '\n')


def square_trim(im: Image.Image, pad: float = 0.06) -> Image.Image:
    box = im.getchannel('A').point(lambda v: 255 if v > 8 else 0).getbbox() or (0, 0, *im.size)
    cx, cy = (box[0] + box[2]) / 2, (box[1] + box[3]) / 2
    side = max(box[2] - box[0], box[3] - box[1]) * (1 + 2 * pad)
    out = Image.new('RGBA', (round(side), round(side)), (0, 0, 0, 0))
    out.paste(im, (round(side / 2 - cx), round(side / 2 - cy)))
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--root', type=pathlib.Path, required=True)
    a = ap.parse_args()
    dest = a.root / 'ios' / 'Images.xcassets'
    dest.mkdir(parents=True, exist_ok=True)
    (dest / 'Contents.json').write_text(json.dumps({'info': {'author': 'xcode', 'version': 1}}, indent=2) + '\n')
    n = 0
    for p in sorted((a.root / 'icons' / 'raw').glob('*.png')):
        src = Image.open(p).convert('RGB')
        w, h = src.size
        src = src.crop((CROP, CROP, w - CROP, h - CROP))  # renders carry a faint edge line that would widen the trim
        im = knockout(src, None, tol=34, fringe=2, global_=p.stem not in KEEP_ISLANDS)
        write_set(dest, f'icon-{p.stem}', square_trim(im), 96)
        n += 1
    for p in sorted((a.root / 'raw').glob('vibe-*.png')):
        write_set(dest, p.stem, Image.open(p).convert('RGB').convert('RGBA'), 320)
        n += 1
    print(f'{n} image sets in {dest}')


if __name__ == '__main__':
    main()
