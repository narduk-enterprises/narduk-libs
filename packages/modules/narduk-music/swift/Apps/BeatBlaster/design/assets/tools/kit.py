#!/usr/bin/env python3
"""Set up, keep, derive and gate a product asset kit drawn by an image model (grok, sol, astra or cursor).

    kit.py init   --root <kit> --name NAME                          kit.json, .gitignore, tools/ (a copy of these scripts)
    kit.py keep   --root <kit> <render> <name> --kind KIND [--backend grok|sol|astra|cursor] [--tool T] [--model M]
                  (--prompt TEXT | --prompt-file FILE | --prompt-index <raw/index.md>) [--from NAME] [--round N]
                  [--category C --label L --keywords a,b]            (icons only)
    kit.py derive --root <kit> [name ...] 
    kit.py check  --root <kit>                                      (exit 0 = PASS)

Nothing here draws. `keep` converts one kept render (a JPEG from grok, a PNG from Codex) into raw/<name>.png, or
icons/raw/<name>.png for --kind icon, and records the exact prompt, the backend and the tool in the manifest.
`derive` only resizes, crops, pads, snaps to the palette, knocks a flat ground out and traces the logo vector (logo.py)
from kept renders. `check` is the gate. keep and derive need ImageMagick 7 (`magick`); a palette, a transparent or dark
illustration or a `logo` block also need pillow, numpy and scipy (logo.py: potrace and librsvg too); check is pure Python.
"""
import argparse
import hashlib
import json
import pathlib
import re
import shutil
import struct
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import check_icons  # noqa: E402  (ships beside this script, in the skill and in <kit>/tools/)
import provenance  # noqa: E402

KINDS = ('app-icon', 'mark', 'og', 'hero', 'illustration')
SQUARE = {'app-icon', 'mark'}
SINGLE = {'app-icon', 'og'}  # their outputs have fixed names, so a kit has at most one of each
HERO_WIDTHS = (1920, 960, 480)
ICO_SIZES = (16, 32, 48)
OG = (1200, 630)
RECORD = 'out/.derived.json'  # {asset name: digest of everything its outputs came from; "logo": the vector logo's}
KEBAB = re.compile(r'[a-z0-9]+(-[a-z0-9]+)*')
WORDMARKS = tuple(f'{k}-{m}' for m in ('light', 'dark') for k in ('horizontal', 'stacked', 'text'))
GITIGNORE = ('.lane/', '.venv/', '__pycache__/')


def plan(asset: dict, raw_wh: tuple[int, int]) -> list[dict]:
    """The derived files one kept render must produce. Shared by derive and check."""
    kind, name = asset['kind'], asset['name']
    if kind == 'app-icon':
        def sq(p, s):
            return {'path': p, 'size': (s, s), 'opaque': True}
        return [sq('out/app-icon-1024.png', 1024), sq('out/apple-touch-icon.png', 180),
                sq('out/icon-192.png', 192), sq('out/icon-512.png', 512), sq('out/icon-mask.png', 512),
                {'path': 'out/favicon.ico', 'ico': ICO_SIZES},
                {'path': 'out/site.webmanifest', 'text': 'json'}, {'path': 'out/head-snippet.html', 'text': 'html'}]
    if kind == 'og':
        return [{'path': 'out/og.png', 'size': OG, 'opaque': True}]
    if kind in ('hero', 'illustration'):
        w, h = raw_wh
        widths = [x for x in HERO_WIDTHS if x <= w] or [w]  # never upscale a hero
        outs = [{'path': f'out/{name}-w{x}.png', 'size': (x, round(h * x / w)), 'fuzzy_h': True} for x in widths]
        for variant in ('transparent', 'dark'):  # a flat ground knocked out; dark also swaps palette roles
            if asset.get(variant):
                outs += [{'path': f'out/{name}-{variant}-w{x}.png', 'size': (x, round(h * x / w)), 'fuzzy_h': True,
                          'alpha': True, 'variant': variant} for x in widths]
        return outs
    return []  # mark: a one-colour legibility check, reviewed but not shipped


def logo_outputs(man: dict) -> list[str]:
    """The vector logo files `logo.py` must write when kit.json has a `logo` block."""
    logo = man.get('logo')
    if not logo:
        return []
    dark = any(layer.get('dark_fill') for layer in logo.get('layers', []))
    outs = ['out/favicon.svg', 'out/favicon-small.svg', 'out/logo/mark.svg', 'out/logo/mark-currentColor.svg']
    outs += ['out/logo/mark-on-dark.svg'] if dark else []
    if logo.get('wordmark') is not None:
        for w in WORDMARKS:
            if dark or w.endswith('light'):  # a dark lockup needs the mark for dark grounds
                outs += [f'out/logo/wordmark-{w}.svg', f'out/logo/wordmark-{w}.png']
    return outs


# --- pure-Python readers, so the gate needs no image tooling -----------------------------------------------

def png_info(path: pathlib.Path) -> tuple[int, int, bool]:
    """(width, height, has_alpha) from the IHDR chunk; raises ValueError if it is not a PNG."""
    head = path.read_bytes()[:33]
    if head[:8] != b'\x89PNG\r\n\x1a\n' or head[12:16] != b'IHDR':
        raise ValueError('not a PNG')
    w, h, _depth, colour = struct.unpack('>IIBB', head[16:26])
    return w, h, colour in (4, 6) or b'tRNS' in path.read_bytes()[:4096]


def ico_sizes(path: pathlib.Path) -> list[int]:
    data = path.read_bytes()
    reserved, kind, count = struct.unpack('<HHH', data[:6])
    if reserved != 0 or kind != 1:
        raise ValueError('not an ICO')
    return sorted((data[6 + 16 * i] or 256) for i in range(count))


# --- keep ---------------------------------------------------------------------------------------------------

def load(p: pathlib.Path, default: dict) -> dict:
    return json.loads(p.read_text()) if p.exists() else default


def save(p: pathlib.Path, data: dict) -> None:
    p.write_text(json.dumps(data, indent=2, ensure_ascii=False) + '\n')


def record(root: pathlib.Path, name: str, kind: str, entry: dict, icon_meta: dict | None = None) -> pathlib.Path:
    """Upsert the manifest entry for a kept render; return the manifest path."""
    if kind == 'icon':
        man_p = root / 'icons' / 'manifest.json'
        man = load(man_p, {'name': f"{load(root / 'kit.json', {}).get('name', 'Product')} icons",
                           'categories': [], 'required': [], 'icons': []})
        entry = {'name': name, **icon_meta, **entry}
        if entry['category'] not in man['categories']:
            man['categories'].append(entry['category'])
        items = man['icons']
    else:
        man_p = root / 'kit.json'
        man = load(man_p, {'name': root.resolve().name, 'required': [], 'assets': []})
        entry = {'name': name, 'kind': kind, **entry}
        items = man['assets']
    items[:] = [i for i in items if i.get('name') != name] + [entry]
    man_p.parent.mkdir(parents=True, exist_ok=True)
    save(man_p, man)
    return man_p


def parse_index_prompts(index_md: pathlib.Path) -> dict[str, str]:
    """filename -> the longest cell of that row in a Codex run's raw/index.md (that cell is the exact prompt)."""
    prompts: dict[str, str] = {}
    for line in index_md.read_text(errors='replace').splitlines():
        if not line.startswith('|'):
            continue
        cells = [c.strip() for c in line.strip().strip('|').split('|')]
        m = re.match(r'(?:\*\*)?`?([\w.\-]+\.png)', cells[0]) if cells else None
        if m and len(cells) >= 3:
            prompts[m.group(1)] = max(cells[1:], key=len).replace('<br>', '\n')
    return prompts


def drawing_entry(a_backend: str, tool: str | None, model: str | None, prompt: str, round_: int,
                  from_: str | None) -> dict:
    """The provenance fields of one kept render."""
    entry = {'backend': a_backend, 'tool': tool or provenance.DEFAULT_TOOL[a_backend]}
    if a_backend in provenance.MODELS:
        entry['model'] = model or provenance.MODELS[a_backend]
    elif model:
        entry['model'] = model
    entry.update(prompt=prompt, round=round_)
    if from_:
        entry['from'] = from_
    return entry


def keep(a) -> None:
    if not KEBAB.fullmatch(a.name):
        sys.exit(f'{a.name}: name must be kebab-case')
    if a.kind == 'icon' and not (a.category and a.label):
        sys.exit('--kind icon needs --category and --label')
    if a.prompt_index:
        found = parse_index_prompts(a.prompt_index).get(a.render.name)
        if not found:
            sys.exit(f'{a.render.name}: no row in {a.prompt_index} (its first column names the file)')
        prompt = found.strip()
    else:
        prompt = (a.prompt_file.read_text() if a.prompt_file else a.prompt or '').strip()
    if not prompt:
        sys.exit('the exact prompt of the kept render is required (--prompt, --prompt-file or --prompt-index)')
    entry = drawing_entry(a.backend, a.tool, a.model, prompt, a.round, a.from_)
    if entry['tool'] == 'image_edit' and not a.from_:
        sys.exit('--tool image_edit needs --from: the render it edited')
    bad = provenance.problems(entry)
    if bad:
        sys.exit(f"--backend {a.backend} --tool {entry['tool']}: {'; '.join(bad)}")
    if not a.render.is_file():
        sys.exit(f'{a.render}: render not found')
    need_magick()
    dest = a.root / ('icons/raw' if a.kind == 'icon' else 'raw') / f'{a.name}.png'
    dest.parent.mkdir(parents=True, exist_ok=True)
    try:
        sh('magick', a.render, '-auto-orient', '-strip', f'PNG:{dest}')
    except subprocess.CalledProcessError as e:
        sys.exit(f'{a.render}: magick could not convert it: {e.stderr.strip()}')
    meta = {'category': a.category, 'label': a.label,
            'keywords': [k.strip() for k in (a.keywords or a.name).split(',') if k.strip()]}
    man = record(a.root, a.name, a.kind, entry, meta if a.kind == 'icon' else None)
    print(f'kept {dest.relative_to(a.root)}; prompt and backend recorded in {man.relative_to(a.root)}')


def init(a) -> None:
    """kit.json (when absent), .gitignore, and tools/: a copy of these scripts so the kit rebuilds without the repo."""
    a.root.mkdir(parents=True, exist_ok=True)
    kit_p = a.root / 'kit.json'
    if not kit_p.exists():
        save(kit_p, {'name': a.name, 'required': [], 'assets': []})
    gi = a.root / '.gitignore'
    have = gi.read_text().splitlines() if gi.exists() else []
    gi.write_text('\n'.join(have + [g for g in GITIGNORE if g not in have]) + '\n')
    tools = a.root / 'tools'
    shutil.copytree(HERE, tools, dirs_exist_ok=True, ignore=shutil.ignore_patterns('__pycache__'))
    print(f'kit ready at {a.root}; edit kit.json (name, required, palette), then draw and keep')


# --- derive -------------------------------------------------------------------------------------------------

def sh(*args) -> str:
    return subprocess.run([str(x) for x in args], check=True, capture_output=True, text=True).stdout.strip()


def sha256(p: pathlib.Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def need_magick() -> None:
    if not shutil.which('magick'):
        sys.exit('magick not found on PATH (brew install imagemagick)')


def snapping(asset: dict, man: dict) -> bool:
    """Snap to the palette when kit.json has one, unless the asset says `"snap": false`. A mark ships nothing."""
    return bool(man.get('palette')) and asset.get('snap') is not False and asset['kind'] != 'mark'


def inputs(asset: dict, man: dict) -> dict:
    """The settings, besides the render itself, that change what derive writes for this asset."""
    cfg: dict = {}
    if snapping(asset, man):
        cfg['palette'] = man['palette']
        cfg['snap_tol'] = man.get('snap_tol')
    for k in ('transparent', 'dark'):
        if asset.get(k):
            cfg[k] = asset[k]
    if asset['kind'] == 'app-icon':
        cfg.update(logo=man.get('logo'), theme_color=man.get('theme_color'), name=man.get('name'))
    return cfg


def digest(root: pathlib.Path, asset: dict, man: dict) -> str:
    """sha256 of the kept render plus the settings its outputs depend on, so a re-kept render or an edited
    palette, variant or logo block is flagged until derive runs again."""
    h = hashlib.sha256((root / 'raw' / f"{asset['name']}.png").read_bytes())
    cfg = inputs(asset, man)
    if cfg:
        h.update(json.dumps(cfg, sort_keys=True).encode())
    return h.hexdigest()


def snapped(raw: pathlib.Path, asset: dict, man: dict, tmp: pathlib.Path) -> pathlib.Path:
    """The render with near-palette pixels snapped onto the exact brand hex (a copy in tmp), else the render."""
    if not snapping(asset, man):
        return raw
    import lib  # pillow and numpy; only a kit with a palette needs them
    pal = {k: lib.hex_rgb(v) for k, v in man['palette'].items()}
    tol = lib.snap_tol(man, 'logo' if asset['kind'] == 'app-icon' else 'default')
    dest = tmp / f'{raw.stem}-snapped.png'
    lib.snap(lib.load_rgb(raw), pal, tol).save(dest)
    return dest


def variant_png(src: pathlib.Path, asset: dict, man: dict, variant: str, tmp: pathlib.Path) -> pathlib.Path:
    """A transparent (flat ground knocked out) or dark (palette roles swapped) full-size copy of an illustration."""
    import lib
    from knockout_bg import knockout, swap_colours
    im = knockout(lib.load_rgb(src), None, tol=30)
    if variant == 'dark':
        pal = {k: lib.hex_rgb(v) for k, v in (man.get('palette') or {}).items()}
        swap = asset['dark'] if isinstance(asset['dark'], list) else [['ink', 'white']]
        if not pal:
            sys.exit('a dark variant swaps palette roles; give kit.json a `palette`')
        im = swap_colours(im, swap, pal)
    dest = tmp / f'{src.stem}-{variant}.png'
    im.save(dest)
    return dest


def theme_colour(src: pathlib.Path, man: dict) -> str:
    return man.get('theme_color') or '#' + sh('magick', src, '-format', '%[hex:u.p{2,2}]', 'info:')[:6].upper()


def write_web_wiring(root: pathlib.Path, man: dict, src: pathlib.Path) -> None:
    colour = theme_colour(src, man)
    name = man.get('name', 'App')
    icons = [{'src': '/icon-192.png', 'sizes': '192x192', 'type': 'image/png', 'purpose': 'any'},
             {'src': '/icon-512.png', 'sizes': '512x512', 'type': 'image/png', 'purpose': 'any'},
             {'src': '/icon-mask.png', 'sizes': '512x512', 'type': 'image/png', 'purpose': 'maskable'}]
    (root / 'out/site.webmanifest').write_text(json.dumps(
        {'name': name, 'short_name': name, 'theme_color': colour, 'background_color': colour,
         'display': 'standalone', 'icons': icons}, indent=2) + '\n')
    svg = '<link rel="icon" href="/favicon.svg" type="image/svg+xml">\n' if man.get('logo') else ''
    (root / 'out/head-snippet.html').write_text(
        svg + '<link rel="icon" href="/favicon.ico" sizes="48x48">\n'
        '<link rel="apple-touch-icon" href="/apple-touch-icon.png">\n'
        '<link rel="manifest" href="/site.webmanifest">\n'
        f'<meta name="theme-color" content="{colour}">\n')


def derive_one(root: pathlib.Path, asset: dict, man: dict, radius: float) -> list[str]:
    raw = root / 'raw' / f"{asset['name']}.png"
    w, h, _ = png_info(raw)
    notes, flat = [], ['-background', 'white', '-alpha', 'remove', '-alpha', 'off']
    with tempfile.TemporaryDirectory() as t:
        tmp = pathlib.Path(t)
        src = snapped(raw, asset, man, tmp)
        for out in plan(asset, (w, h)):
            dest = root / out['path']
            dest.parent.mkdir(parents=True, exist_ok=True)
            if 'text' in out:
                continue  # written once below, from the app icon's corner colour
            if 'ico' in out:
                if man.get('logo'):
                    continue  # logo.py rasterises the ico from the vector favicon: never downsample 1024 to 16
                r = round(256 * radius)
                sh('magick', src, '-alpha', 'set', '-resize', '256x256!', '(', '-size', '256x256', 'xc:none', '-fill',
                   'white', '-draw', f'roundrectangle 0,0,255,255,{r},{r}', ')', '-compose', 'DstIn', '-composite',
                   '-define', f"icon:auto-resize={','.join(map(str, reversed(ICO_SIZES)))}", dest)
                continue
            tw, th = out['size']
            if tw > w or th > h:
                notes.append(f"{out['path']}: upscaled from {w}x{h}; render larger or accept the softness")
            if out.get('variant'):
                import lib
                from PIL import Image
                vsrc = variant_png(src, asset, man, out['variant'], tmp)
                lib.resize_rgba(Image.open(vsrc), (tw, th)).save(dest)
            elif out['path'] == 'out/icon-mask.png':
                # The whole icon shrunk into the maskable safe zone (a centred circle of radius 40%) on its own
                # corner colour, so anything inside the icon's inscribed circle survives every launcher mask.
                ground = sh('magick', src, '-format', '%[pixel:p{2,2}]', 'info:')
                inner = round(tw * 0.8)
                sh('magick', '-size', f'{tw}x{th}', f'xc:{ground}', '(', src, *flat, '-resize', f'{inner}x{inner}!', ')',
                   '-gravity', 'center', '-composite', f'PNG24:{dest}')
            elif out.get('opaque'):
                sh('magick', src, *flat, '-resize', f'{tw}x{th}^', '-gravity', 'center', '-extent', f'{tw}x{th}',
                   f'PNG24:{dest}')
            else:
                sh('magick', src, '-resize', f'{tw}x', f'PNG:{dest}')
        if asset['kind'] == 'app-icon':
            if man.get('logo'):
                import logo
                logo.build(root, man, asset, src)
            write_web_wiring(root, man, src)
    return notes


def derive(a) -> None:
    need_magick()
    man = json.loads((a.root / 'kit.json').read_text())
    assets = [x for x in man.get('assets', []) if not a.names or x['name'] in a.names]
    rec_p = a.root / RECORD
    known = {x['name'] for x in man.get('assets', [])} | {'logo'}
    rec = {k: v for k, v in load(rec_p, {}).items() if k in known}
    for x in assets:
        for n in derive_one(a.root, x, man, a.favicon_radius):
            print('note:', n)
        rec[x['name']] = digest(a.root, x, man)
        if x['kind'] == 'app-icon' and man.get('logo'):
            rec['logo'] = rec[x['name']]
    rec_p.parent.mkdir(parents=True, exist_ok=True)
    save(rec_p, dict(sorted(rec.items())))
    print(f'derived {len(assets)} asset(s)')


# --- check --------------------------------------------------------------------------------------------------

def check(root: pathlib.Path) -> tuple[int, list[str]]:
    errs: list[str] = []
    def err(f, m):
        errs.append(f'{f}: {m}')
    man_p = root / 'kit.json'
    if not man_p.exists():
        return 0, ['kit.json: missing; `kit.py keep` writes it']
    man = json.loads(man_p.read_text())
    assets = man.get('assets', [])
    names = [x.get('name') for x in assets]
    expected: set[str] = set()
    try:
        record_ = json.loads((root / RECORD).read_text())
    except (OSError, ValueError):
        record_ = {}
    if not isinstance(record_, dict):
        record_ = {}
    for dup in sorted({n for n in names if names.count(n) > 1}, key=str):
        err('kit.json', f'{dup}: listed twice')
    for kind in SINGLE:
        if sum(x.get('kind') == kind for x in assets) > 1:
            err('kit.json', f'more than one {kind}; its outputs have fixed names')
    for x in assets:
        n = x.get('name') or '?'
        if not KEBAB.fullmatch(n):
            err('kit.json', f'{n}: name must be kebab-case')
        if x.get('kind') not in KINDS:
            err('kit.json', f"{n}: kind must be one of {', '.join(KINDS)}")
            continue
        for problem in provenance.problems(x):
            err('kit.json', f'{n}: {problem}')
        raw = root / 'raw' / f'{n}.png'
        try:
            w, h, _ = png_info(raw)
        except (OSError, ValueError):
            err(f'raw/{n}.png', 'missing or not a PNG: every asset is a kept image-model render')
            continue
        if x['kind'] in SQUARE and abs(w - h) > max(w, h) * 0.01:
            err(f'raw/{n}.png', f'{w}x{h}; a {x["kind"]} render must be square')
            continue
        outs = plan(x, (w, h))
        if outs and record_.get(n) != digest(root, x, man):
            err(RECORD, f'{n}: out/ was not derived from the current raw/{n}.png and settings; run kit.py derive')
        for out in outs:
            expected.add(out['path'])
            p = root / out['path']
            if not p.exists():
                err(out['path'], 'missing; run kit.py derive')
                continue
            if out.get('text'):
                try:
                    if out['text'] == 'json':
                        json.loads(p.read_text())
                    elif not p.read_text().strip():
                        raise ValueError('empty')
                except ValueError as e:
                    err(out['path'], f'not valid {out["text"]}: {e}')
                continue
            try:
                if 'ico' in out:
                    if ico_sizes(p) != list(out['ico']):
                        err(out['path'], f"sizes {ico_sizes(p)}, want {list(out['ico'])}")
                    continue
                pw, ph, alpha = png_info(p)
            except ValueError as e:
                err(out['path'], str(e))
                continue
            tw, th = out['size']
            if pw != tw or (ph != th and not (out.get('fuzzy_h') and abs(ph - th) <= 1)):
                err(out['path'], f'{pw}x{ph}, want {tw}x{th}')
            if out.get('opaque') and alpha:
                err(out['path'], 'has an alpha channel; app icons, touch icons and OG cards must be opaque')
            if out.get('alpha') and not alpha:
                err(out['path'], 'no alpha channel; a transparent or dark variant must knock its ground out')
    if man.get('logo'):
        icon = next((x for x in assets if x.get('kind') == 'app-icon'), None)
        if not icon:
            err('kit.json', 'a `logo` block traces the app icon: keep an app-icon asset')
        elif record_.get('logo') != record_.get(icon['name']):
            err(RECORD, 'logo: vector logo was not derived with the current app icon and settings; run kit.py derive')
        for path in logo_outputs(man):
            expected.add(path)
            p = root / path
            if not p.exists():
                err(path, 'missing; run kit.py derive')
            elif path.endswith('.svg'):
                try:
                    ET.fromstring(p.read_text())
                except ET.ParseError as e:
                    err(path, f'not well-formed: {e}')
            elif path.endswith('.png'):
                try:
                    if not png_info(p)[2]:
                        err(path, 'wordmark PNGs are transparent; no alpha channel found')
                except ValueError as e:
                    err(path, str(e))
        if icon and (root / 'out/favicon.ico').exists():
            try:
                if ico_sizes(root / 'out/favicon.ico') != list(ICO_SIZES):
                    err('out/favicon.ico', f"sizes {ico_sizes(root / 'out/favicon.ico')}, want {list(ICO_SIZES)}")
            except ValueError as e:
                err('out/favicon.ico', str(e))
    missing = set(man.get('required', [])) - set(names)
    if missing:
        err('kit', 'missing required assets: ' + ', '.join(sorted(missing)))
    out_dir = root / 'out'
    if out_dir.exists():
        stray = sorted(str(p.relative_to(root)) for p in out_dir.rglob('*')
                       if p.is_file() and not p.name.startswith('.'))  # .derived.json, .DS_Store
        stray = [p for p in stray if p not in expected]
        if stray:
            err('out/', 'not produced by derive (remove, or keep the render and derive): ' + ', '.join(stray))
    n_icons = 0
    if (root / 'icons').exists():
        n_icons, icon_errs = check_icons.check(root / 'icons')
        errs += [f'icons/{e}' for e in icon_errs]
    if not assets and not n_icons:
        err('kit', 'nothing kept yet; keep renders with kit.py keep')
    return len(assets) + n_icons, errs


def main(argv=None):
    ap = argparse.ArgumentParser(description='Set up, keep, derive and gate an image-model-drawn product asset kit.')
    sub = ap.add_subparsers(dest='cmd', required=True)
    i = sub.add_parser('init', help='kit.json, .gitignore and a tools/ copy of these scripts')
    i.add_argument('--name', required=True)
    k = sub.add_parser('keep', help='convert a kept render into raw/ and record its prompt, backend and tool')
    k.add_argument('render', type=pathlib.Path)
    k.add_argument('name')
    k.add_argument('--kind', required=True, choices=KINDS + ('icon',))
    k.add_argument('--backend', default='grok', choices=tuple(provenance.BACKENDS),
                   help='who drew it: grok (default), sol, astra or cursor')
    k.add_argument('--tool', choices=provenance.TOOLS, help='default: the backend\'s tool (grok: image_gen)')
    k.add_argument('--model', help='default: the Codex model id for sol and astra')
    k.add_argument('--prompt')
    k.add_argument('--prompt-file', type=pathlib.Path)
    k.add_argument('--prompt-index', type=pathlib.Path, help='a Codex run\'s raw/index.md: take the row named like the render')
    k.add_argument('--from', dest='from_', help='the render this one edited (image_edit) or was drawn from (a reference)')
    k.add_argument('--round', type=int, default=1)
    k.add_argument('--category')
    k.add_argument('--label')
    k.add_argument('--keywords', help='comma-separated; default: the name')
    d = sub.add_parser('derive', help='resize kept renders into the shipped sizes, trace the logo vector')
    d.add_argument('names', nargs='*')
    d.add_argument('--favicon-radius', type=float, default=0.22, help='favicon corner radius, fraction of side')
    sub.add_parser('check', help='the gate; exit 0 = PASS')
    for p in sub.choices.values():
        p.add_argument('--root', type=pathlib.Path, default=pathlib.Path.cwd(), help='kit dir (default: cwd)')
    a = ap.parse_args(argv)
    if a.cmd == 'init':
        init(a)
    elif a.cmd == 'keep':
        keep(a)
    elif a.cmd == 'derive':
        derive(a)
    else:
        n, errs = check(a.root)
        print(f'{n} assets checked')
        if errs:
            print('\n'.join(errs))
            sys.exit(1)
        print('PASS')


if __name__ == '__main__':
    main()
