#!/usr/bin/env python3
"""Build an icon pack's contact sheet: preview.py --root <pack>

Inlines every svg/<name>.svg as-is (no redrawing) at 16, 24 and 40 px, grouped by the manifest's categories, on
each theme ground. Icons take their colour from `color` through currentColor. Themes come from the manifest's
optional "preview": {"themes": [{"key", "label", "bg", "ink"}, ...]}; the default is a light and a dark ground.
"""
import argparse, html, json, pathlib

SIZES = (16, 24, 40)
DEFAULT_THEMES = [{'key': 'day', 'label': 'Light', 'bg': '#F4F5F6', 'ink': '#15181B'},
                  {'key': 'night', 'label': 'Dark', 'bg': '#111417', 'ink': '#E9ECEF'}]

CSS = """  :root { color-scheme: light; }
  body { margin: 0; font: 14px/1.4 ui-sans-serif, system-ui, sans-serif; background: #d9dcdf; color: #15181B; }
  header { padding: 28px 32px 8px; }
  h1 { font-size: 22px; font-weight: 600; margin: 0 0 4px; }
  p.lead { margin: 0; max-width: 40rem; }
  .theme { margin: 20px; padding: 24px; border-radius: 12px; }
  .theme h2 { font-size: 13px; letter-spacing: 0.08em; text-transform: uppercase; margin: 28px 0 12px; font-weight: 600; }
  .theme .cat:first-of-type h2 { margin-top: 0; }
  .banner { font-size: 12px; letter-spacing: 0.12em; text-transform: uppercase; margin: 0 0 8px; opacity: 0.7; }
  .grid { display: flex; flex-wrap: wrap; gap: 18px 14px; }
  figure.icon { margin: 0; width: 112px; }
  .sizes { display: flex; align-items: flex-end; gap: 10px; min-height: 40px; }
  .slot { display: inline-flex; color: inherit; }
  .slot svg { width: 100%; height: 100%; display: block; }
  figcaption { margin-top: 6px; font-size: 12px; font-variant-numeric: tabular-nums; }"""


def main(argv=None):
    ap = argparse.ArgumentParser(description='Build an icon pack contact sheet.')
    ap.add_argument('--root', type=pathlib.Path, default=pathlib.Path.cwd(), help='pack dir (default: cwd)')
    root = ap.parse_args(argv).root
    man = json.loads((root / 'manifest.json').read_text())
    THEMES = [(t['key'], t['label'], t['bg'], t['ink']) for t in man.get('preview', {}).get('themes', DEFAULT_THEMES)]
    svgs = {p.stem: p.read_text().strip() for p in sorted((root / 'svg').glob('*.svg'))}
    title = html.escape(man.get('name', 'Icons'))
    css = CSS + ''.join(f'\n  .theme.{k} {{ background: {bg}; color: {ink}; }}' for k, _, bg, ink in THEMES)
    out = ['<!DOCTYPE html>', '<html lang="en">', '<head>', '<meta charset="utf-8">', f'<title>{title}</title>',
           f'<style>\n{css}\n</style>', '</head>', '<body>', '<header>', f'  <h1>{title}</h1>',
           f'  <p class="lead">{len(svgs)} icons, each shown at {", ".join(map(str, SIZES[:-1]))} and {SIZES[-1]} px. '
           'Colour comes from <code>color</code> through <code>currentColor</code>.</p>', '</header>']
    for key, label, bg, ink in THEMES:
        out += [f'<div class="theme {key}">', f'  <p class="banner">{label} · {bg} / {ink}</p>']
        for cat in man['categories']:
            icons = [i for i in man['icons'] if i['category'] == cat and i['name'] in svgs]
            if not icons:
                continue
            out.append(f'  <section class="cat"><h2>{html.escape(cat)}</h2><div class="grid">')
            for i in icons:
                slots = ''.join(f'<span class="slot s{s}" style="width:{s}px;height:{s}px">{svgs[i["name"]]}</span>'
                                for s in SIZES)
                out.append(f'<figure class="icon" title="{html.escape(i.get("label", ""))}"><div class="sizes">{slots}'
                           f'</div><figcaption>{i["name"]}</figcaption></figure>')
            out.append('</div></section>')
        out.append('</div>')
    out += ['</body>', '</html>', '']
    (root / 'preview.html').write_text('\n'.join(out))
    print(f'preview.html: {len(svgs)} icons')


if __name__ == '__main__':
    main()
