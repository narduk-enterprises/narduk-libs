#!/usr/bin/env python3
"""Gate for an image-model-drawn icon pack: check_icons.py --root <pack>  (exit 0 = PASS).

Checks that every svg/<name>.svg is trace.py output traced from a raw/<name>.png render, that manifest.json lists
exactly the svg set with the exact prompt, the backend and the drawing tool per icon (provenance.py: grok, sol,
astra or cursor; an icon cut from a sheet also names its sheet, kept under sheets/), that every name in the
manifest's optional `required` list exists, and that preview.html shows every icon and README.md exists.
"""
import argparse
import json
import pathlib
import re
import sys
import xml.etree.ElementTree as ET

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import provenance  # noqa: E402  (ships beside this script, in the skill and in <kit>/tools/)

NS = '{http://www.w3.org/2000/svg}'
VIEWBOX = '0 0 480 480'
MAX_BYTES = 40000
ALLOWED = {'svg', 'g', 'path', 'title'}


def check(root: pathlib.Path) -> tuple[int, list[str]]:
    errs: list[str] = []
    def err(f, m):
        errs.append(f'{f}: {m}')
    files = sorted((root / 'svg').glob('*.svg'))
    names = {f.stem for f in files}
    if not files:
        err('svg/', 'no icons; render into raw/ and run trace.py')
    for f in files:
        if not re.fullmatch(r'[a-z0-9]+(-[a-z0-9]+)*', f.stem):
            err(f.name, 'name must be kebab-case')
        if not (root / 'raw' / f'{f.stem}.png').exists():
            err(f.name, 'no raw/<name>.png: every icon is traced from a kept image-model render')
        txt = f.read_text()
        if re.search(r'style=|<style|<script|foreignObject|<image|href=|#[0-9a-fA-F]{3,6}\b|rgb\(', txt):
            err(f.name, 'no style, script, images, links or hard-coded colours')
        try:
            svg = ET.fromstring(txt)
        except ET.ParseError as e:
            err(f.name, f'not well-formed: {e}')
            continue
        if svg.tag != NS + 'svg' or svg.attrib.get('viewBox') != VIEWBOX or svg.attrib.get('fill') != 'currentColor':
            err(f.name, f'must be trace.py output: viewBox "{VIEWBOX}", fill="currentColor"')
        if not any(el.tag == NS + 'path' for el in svg.iter()):
            err(f.name, 'empty icon')
        for el in svg.iter():
            if el.tag.replace(NS, '') not in ALLOWED:
                err(f.name, f"element <{el.tag.replace(NS, '')}> not allowed")
        if len(txt) > MAX_BYTES:
            err(f.name, f'{len(txt)} bytes; too detailed for an icon, simplify the render')

    man_p = root / 'manifest.json'
    if not man_p.exists():
        err('manifest.json', 'missing')
    else:
        man = json.loads(man_p.read_text())
        icons = man.get('icons', [])
        listed = {i.get('name') for i in icons}
        for i in icons:
            for k in ('name', 'category', 'label', 'keywords'):
                if not i.get(k):
                    err('manifest.json', f"{i.get('name')}: missing {k}")
            for problem in provenance.problems(i):
                err('manifest.json', f"{i.get('name')}: {problem}")
            if i.get('sheet') and not (root / 'sheets' / f"{i['sheet']}.png").exists():
                err('manifest.json', f"{i.get('name')}: sheet {i['sheet']} is not kept in sheets/")
        if listed != names:
            err('manifest.json', f'icons listed {sorted(map(str, listed ^ names))} do not match svg/')
        if not set(man.get('categories', [])) >= {i.get('category') for i in icons}:
            err('manifest.json', 'every icon category must be in categories[]')
        missing = set(man.get('required', [])) - names
        if missing:
            err('pack', 'missing required icons: ' + ', '.join(sorted(missing)))
    preview = root / 'preview.html'
    if not preview.exists():
        err('preview.html', 'missing; run preview.py')
    else:
        page = preview.read_text()
        absent = [f.stem for f in files if f'>{f.stem}<' not in page]
        if absent:
            err('preview.html', 'stale; missing ' + ', '.join(absent) + ' (run preview.py)')
    if not (root / 'README.md').exists():
        err('README.md', 'missing')
    return len(files), errs


def main(argv=None):
    ap = argparse.ArgumentParser(description='Gate for an Imagine-drawn icon pack.')
    ap.add_argument('--root', type=pathlib.Path, default=pathlib.Path.cwd(), help='pack dir (default: cwd)')
    n, errs = check(ap.parse_args(argv).root)
    print(f'{n} icons checked')
    if errs:
        print('\n'.join(errs))
        sys.exit(1)
    print('PASS')


if __name__ == '__main__':
    main()
