#!/usr/bin/env python3
"""Trace Grok Imagine renders into currentColor SVG icons.

    trace.py --root <pack> [name ...]

Reads <pack>/raw/<name>.png (a dark glyph on a light ground) and writes <pack>/svg/<name>.svg. With no names,
traces every raw/*.png. Deterministic; nothing is drawn in code.

Each render is normalised before tracing so the set reads as one family:
1. optical size: the glyph is scaled so the square root of its bounding-box area is the same for every icon
   (a wide boat no longer looks small next to a tall buoy), capped so its longest side fits the frame;
2. uniform stroke: the glyph is thinned to its centreline, short spurs at line ends are pruned, and the
   centreline is redrawn with one round pen (--stroke-r);
3. clearly solid areas (wider than ~1.7x the render's own stroke) are kept as solids.

Needs ImageMagick 7 (`magick`) and potrace on PATH.
"""
import argparse, os, pathlib, re, shutil, subprocess, sys, tempfile
from concurrent.futures import ThreadPoolExecutor

SIZE = 480  # trace canvas and SVG viewBox, px


def sh(*a) -> str:
    return subprocess.run([str(x) for x in a], check=True, capture_output=True, text=True).stdout.strip()


def count(png) -> float:  # white pixels in a black-ground mask
    return float(sh('magick', png, '-format', '%[fx:mean*w*h]', 'info:'))


def normalise(png: pathlib.Path, t: pathlib.Path, optical: int, max_side: int, r: int) -> pathlib.Path:
    ink = t / 'ink.png'
    # PNGs from Imagine carry alpha; without flattening it, -extent below turns the whole frame white.
    sh('magick', png, '-background', 'white', '-alpha', 'remove', '-alpha', 'off', '-colorspace', 'Gray',
       '-threshold', '55%', '-trim', '+repage', ink)
    w, h = map(int, sh('magick', ink, '-format', '%w %h', 'info:').split())
    s = min(optical / (w * h) ** 0.5, max_side / max(w, h))
    bin_ = t / 'bin.png'
    sh('magick', ink, '-resize', f'{max(1, round(w * s))}x{max(1, round(h * s))}!', '+repage', '-gravity', 'center',
       '-background', 'white', '-extent', f'{SIZE}x{SIZE}', '-negate', '-threshold', '50%', bin_)
    skel0, skel = t / 'skel0.png', t / 'skel.png'
    sh('magick', bin_, '-morphology', 'Thinning:-1', 'Skeleton', skel0)
    stroke = max(1, round(count(bin_) / max(count(skel0), 1)))  # the render's own line width
    sh('magick', skel0, '-morphology', f'Thinning:{max(r, round(0.9 * stroke))}', 'LineEnds', skel)
    pen, solid, out = t / 'pen.png', t / 'solid.png', t / 'norm.pbm'
    sh('magick', skel, '-morphology', 'Dilate', f'Disk:{r}', pen)
    sh('magick', bin_, '-morphology', 'Open', f'Disk:{max(26, round(1.7 * stroke))}', solid)
    sh('magick', pen, solid, '-compose', 'Lighten', '-composite', '-negate', '-threshold', '50%', out)
    return out


def trace(png: pathlib.Path, args) -> str:
    with tempfile.TemporaryDirectory() as d:
        pbm = normalise(png, pathlib.Path(d), args.optical, args.max_side, args.stroke_r)
        svg = sh('potrace', pbm, '-b', 'svg', '-o', '-', '--flat', '-t', '6', '-a', '1.0', '-O', '0.4',
                 '-W', f'{SIZE}pt', '-H', f'{SIZE}pt')
    paths = re.findall(r'<path d="([^"]+)"', svg)
    m = re.search(r'<g transform="([^"]+)"', svg)
    if not m:
        raise RuntimeError(f'{png.name}: potrace gave no <g transform>; is the render blank?')
    g = m.group(1)
    body = ''.join(f'<path d="{" ".join(d.split())}"/>' for d in paths)
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {SIZE} {SIZE}" fill="currentColor">'
            f'<g transform="{g}">{body}</g></svg>\n')


def main(argv=None):
    ap = argparse.ArgumentParser(description='Trace Grok Imagine renders into currentColor SVG icons.')
    ap.add_argument('--root', type=pathlib.Path, default=pathlib.Path.cwd(), help='pack dir holding raw/ (default: cwd)')
    ap.add_argument('--optical', type=int, default=330, help='sqrt(w*h) of every glyph, px of 480 (default 330)')
    ap.add_argument('--max-side', type=int, default=430, help='longest-side cap, px of 480 (default 430)')
    ap.add_argument('--stroke-r', type=int, default=14, help='pen radius, px of 480 (default 14 = ~1.4 px at 24 px)')
    ap.add_argument('--jobs', type=int, default=min(6, os.cpu_count() or 1))
    ap.add_argument('names', nargs='*')
    args = ap.parse_args(argv)
    for tool in ('magick', 'potrace'):
        if not shutil.which(tool):
            sys.exit(f'{tool} not found on PATH (brew install imagemagick potrace)')
    raw, out = args.root / 'raw', args.root / 'svg'
    out.mkdir(exist_ok=True)
    pngs = [raw / f'{n}.png' for n in args.names] if args.names else sorted(raw.glob('*.png'))

    def one(p: pathlib.Path):
        (out / f'{p.stem}.svg').write_text(trace(p, args))

    with ThreadPoolExecutor(args.jobs) as ex:
        list(ex.map(one, pngs))
    print(f'traced {len(pngs)}')


if __name__ == '__main__':
    main()
