#!/usr/bin/env python3
"""Draw with Grok Imagine through a direct, image-tools-only grok run: one asset per run, N renders, many in parallel.

    grok_draw.py --out DIR --name NAME (--prompt TEXT | --prompt-file FILE) [--count 2] [--aspect 1:1]
                 [--edit SOURCE_IMAGE]
    grok_draw.py --out DIR --batch jobs.json [--jobs 12]          jobs.json: [{"name", "prompt"|"prompt_file",
                                                                   "count"?, "aspect"?, "edit"?}, ...]

This is the default Grok route until agent-infrastructure#2391 (grok-lane ends after one narration line, no
image_gen call) is fixed; SKILL.md says why it is acceptable. Each job:
  1. makes a fresh EMPTY scratch directory and, for an edit, copies the source image into it as source.<ext>;
  2. runs `grok --prompt-file ... --permission-mode dontAsk --tools image_gen|image_edit --disable-web-search
     --no-subagents --cwd <scratch> --output-format plain`: with --tools limited to the image tool the model cannot
     run a shell or edit a file, so there is nothing to sandbox;
  3. collects the renders from ~/.grok/sessions/<url-encoded cwd>/<session>/images/<n>.jpg (the plain output often
     omits the path) into DIR/<name>-<k>.jpg, and writes DIR/<name>.prompt.txt (the exact prompt, not the wrapper
     this script adds) and DIR/<name>.json.
Run it outside the Claude Code Bash sandbox. Look at every render, then `kit.py keep` the one worth keeping with
`--prompt-file DIR/<name>.prompt.txt`. Nothing here draws or edits pixels. Exit 1 if any job made no render.
"""
import argparse
import json
import pathlib
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.parse
from concurrent.futures import ThreadPoolExecutor

GROK_HOME = pathlib.Path.home() / '.grok'
TOOLS = {'gen': 'image_gen', 'edit': 'image_edit'}


def wrap(prompt: str, count: int, aspect: str, edit: str | None) -> str:
    """The run's instruction: call the one image tool `count` times with the prompt verbatim, and nothing else."""
    if edit:
        call = (f'Call your image_edit tool exactly {count} time(s). Each call: image = ["./{edit}"], prompt = the text '
                'between the markers verbatim.')
    else:
        call = (f'Call your image_gen tool exactly {count} time(s). Each call: aspect_ratio = "{aspect}", prompt = the '
                'text between the markers verbatim.')
    return (f'{call} Make the calls one after another, then reply with the single word "done". Call no other tool, '
            f'write no code and ask no questions.\n\n<<<PROMPT\n{prompt}\nPROMPT>>>\n')


def renders(cwd: pathlib.Path) -> list[pathlib.Path]:
    """Images of every session grok opened in this scratch directory, oldest first."""
    found: list[pathlib.Path] = []
    for c in dict.fromkeys([cwd, cwd.resolve()]):  # grok may record the symlinked or the real path (/var vs /private/var)
        found += (GROK_HOME / 'sessions' / urllib.parse.quote(str(c), safe='')).glob('*/images/*')
    key = lambda p: (p.parent.parent.stat().st_mtime, int(p.stem) if p.stem.isdigit() else 0, p.name)  # noqa: E731
    return sorted({p.resolve(): p for p in found}.values(), key=key)


def run_job(job: dict, out: pathlib.Path, timeout: int, keep_scratch: bool) -> dict:
    name = job['name']
    prompt = (pathlib.Path(job['prompt_file']).read_text() if job.get('prompt_file') else job.get('prompt', '')).strip()
    edit = job.get('edit')
    res = {'name': name, 'prompt': prompt, 'tool': 'image_edit' if edit else 'image_gen',
           'count': int(job.get('count', 2)), 'aspect': job.get('aspect', '1:1'), 'renders': [], 'error': None}
    if not prompt:
        res['error'] = 'empty prompt'
        return res
    if edit and not pathlib.Path(edit).is_file():
        res['error'] = f'edit source not found: {edit}'
        return res
    scratch = pathlib.Path(tempfile.mkdtemp(prefix=f'grok-draw-{name}-')).resolve()
    try:
        src_name = None
        if edit:
            src_name = 'source' + pathlib.Path(edit).suffix
            shutil.copy(edit, scratch / src_name)
            res['from_file'] = str(edit)
        pf = scratch.parent / f'{scratch.name}.prompt.txt'  # outside the cwd, so the cwd stays empty but for the source
        pf.write_text(wrap(prompt, res['count'], res['aspect'], src_name))
        cmd = ['grok', '--prompt-file', str(pf), '--permission-mode', 'dontAsk', '--tools', res['tool'],
               '--disable-web-search', '--no-subagents', '--cwd', str(scratch), '--output-format', 'plain']
        t0 = time.time()
        try:
            r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, cwd=scratch)
            res['exit'], res['seconds'] = r.returncode, round(time.time() - t0)
            res['stdout_tail'] = r.stdout.strip()[-400:]
            res['stderr_tail'] = r.stderr.strip()[-400:]
        except subprocess.TimeoutExpired:
            res['error'] = f'timed out after {timeout}s'
        finally:
            pf.unlink(missing_ok=True)
        found = renders(scratch)
        for k, p in enumerate(found, 1):
            dest = out / f'{name}-{k}{p.suffix}'
            shutil.copy2(p, dest)
            res['renders'].append(str(dest))
        if not found and not res['error']:
            blob = (res.get('stdout_tail', '') + res.get('stderr_tail', '')).lower()
            res['error'] = ('not signed in: run `grok` once and sign in (never read ~/.grok/auth.json)'
                            if 'not authenticated' in blob else
                            'no image_gen/image_edit call made (the #2391 failure shape): no renders under '
                            f'~/.grok/sessions/{urllib.parse.quote(str(scratch), safe="")}')
        elif len(found) != res['count']:
            res['note'] = f"asked for {res['count']} renders, found {len(found)}"
    finally:
        if not keep_scratch:
            shutil.rmtree(scratch, ignore_errors=True)
    (out / f'{name}.prompt.txt').write_text(prompt + '\n')
    (out / f'{name}.json').write_text(json.dumps(res, indent=2) + '\n')
    return res


def main(argv=None) -> None:
    ap = argparse.ArgumentParser(description='Draw with Grok Imagine: one direct image-tools-only run per asset.')
    ap.add_argument('--out', type=pathlib.Path, required=True, help='directory for the renders (created)')
    ap.add_argument('--name', help='asset name (kebab-case); renders are DIR/<name>-<k>.jpg')
    ap.add_argument('--prompt')
    ap.add_argument('--prompt-file', type=pathlib.Path)
    ap.add_argument('--count', type=int, default=2, help='renders per asset (default 2)')
    ap.add_argument('--aspect', default='1:1', help='image_gen aspect_ratio (default 1:1)')
    ap.add_argument('--edit', type=pathlib.Path, help='image_edit this source image instead of image_gen')
    ap.add_argument('--batch', type=pathlib.Path, help='JSON list of jobs; relative paths resolve from the CWD')
    ap.add_argument('--jobs', type=int, default=12, help='parallel runs (12 worked; default 12)')
    ap.add_argument('--timeout', type=int, default=900, help='seconds per run (default 900)')
    ap.add_argument('--keep-scratch', action='store_true')
    a = ap.parse_args(argv)
    if not shutil.which('grok'):
        sys.exit('grok not found on PATH')
    if a.batch:
        jobs = json.loads(a.batch.read_text())
    elif a.name and (a.prompt or a.prompt_file):
        jobs = [{'name': a.name, 'prompt': a.prompt, 'prompt_file': a.prompt_file, 'count': a.count,
                 'aspect': a.aspect, 'edit': a.edit}]
    else:
        sys.exit('give --batch, or --name with --prompt/--prompt-file')
    for j in jobs:
        j.setdefault('count', a.count)
        j.setdefault('aspect', a.aspect)
    a.out.mkdir(parents=True, exist_ok=True)
    with ThreadPoolExecutor(max(1, min(a.jobs, len(jobs)))) as ex:
        results = list(ex.map(lambda j: run_job(j, a.out, a.timeout, a.keep_scratch), jobs))
    bad = 0
    for r in results:
        status = 'FAIL ' + r['error'] if r['error'] else f"{len(r['renders'])} render(s) in {r.get('seconds', '?')}s"
        print(f"{r['name']}: {status}" + (f" ({r['note']})" if r.get('note') else ''))
        for p in r['renders']:
            print(f'  {p}')
        bad += bool(r['error'])
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
