# Claude Code cloud environment

Claude Code on the web (claude.ai/code) runs agent sessions in an Ubuntu VM.
narduk-libs has its own environment there, named `narduk-libs`. Use it for any
cloud session whose work is in this repo. The estate-wide `narduk-enterprises`
environment still exists for repos without their own.

## Fields

| Field                 | Value                                                                                            |
| --------------------- | ------------------------------------------------------------------------------------------------ |
| Name                  | `narduk-libs`                                                                                    |
| Network access        | Full, the same as the estate environment.                                                        |
| Environment variables | `AGENT_CLOUD=1` and `COREPACK_ENABLE_DOWNLOAD_PROMPT=0`. No secrets.                             |
| Setup script          | A pasted copy of [`scripts/claude-cloud-env-setup.sh`](../../scripts/claude-cloud-env-setup.sh). |

Anyone who can use the environment can read its variables, so they never hold a
secret. The environment needs none: every `@narduk-enterprises` package this
repo installs is a workspace package, so `pnpm install --frozen-lockfile` works
without a registry token. Publishing, Cloudflare work and credential minting
belong on a Mac, not in a cloud session.

## What the setup script installs

1. The estate baseline, when it can be fetched. The script tries to clone
   agent-infrastructure to `~/.local/share/agent-infrastructure` and run its
   `scripts/claude-cloud-env-setup.sh`, which adds the estate `AGENTS.md` to
   `~/.claude/CLAUDE.md`. agent-infrastructure is private, and the session's git
   proxy refuses the clone with a 403 even when the repo is attached to the
   session (#952). Nothing else in the script depends on it.
2. Node, pnpm and the GitHub CLI, installed directly. Node comes from nodejs.org
   at the `.nvmrc` pin into `/opt/node24`. pnpm is set up through corepack at
   `package.json`'s `packageManager` pin. `gh` comes from Ubuntu's package
   archive. `/etc/profile.d/narduk-node24.sh` puts `/opt/node24/bin` on login
   shells' `PATH`. When a pin changes, change it in the script too.
3. uv, at the version `logging-languages.yml` pins, for the narduk-logging
   Python quality gate.
4. A warm `pnpm install --frozen-lockfile` when the repo is already on disk. It
   also adds a user-level `SessionStart` hook that installs when `node_modules`
   is missing.
5. Playwright Chromium and its system libraries, installed with
   `pnpm exec playwright install --with-deps chromium` as `ci.yml` does. The
   lockfile sets the version, so there is no separate pin to keep in sync.

Steps 4 and 5 are capped at 120 seconds each. A step that times out is skipped,
and the session can run the same command itself.

The Swift toolchain is not installed. It is about 1 GB and does not fit the
setup budget of about 5 minutes. Run `python3 scripts/install-swift-linux.py`
inside a session when you need the narduk-logging Swift gate.

## Merging from a cloud session

A cloud session can push branches and open pull requests through the session's
own GitHub access, but it cannot merge under this repo's merge rule:

- `gh` is installed but not authenticated. The environment holds no token, by
  design, and the session's GitHub access is a git proxy that `gh` cannot use.
  `gh api`, `gh pr merge` and anything built on them fail.
- `verify-pr-gate.py`, which produces the `verdict=GREEN` line a merge has to
  quote, lives in the private agent-infrastructure repo, which the session
  cannot clone.

So a cloud lane stops at an open PR. It keeps the PR body current, puts
`READY TO MERGE @ <full head sha>` on the first line once its own checks pass,
and asks any question as a `NEEDS LOGAN:` comment on the issue. A Mac session
(the program's master, or whoever owns the merge) runs `verify-pr-gate.py` on
that PR, checks the head still matches the SHA, and merges on `verdict=GREEN`
with `--match-head-commit`. Do not put a token into the environment to get
around this; publishing and credentials belong on a Mac.

## Changing the script

The repository file is the reviewed source. After it merges, open the gear icon
beside the environment name at claude.ai/code and paste the whole file into the
Setup script field again. Editing only the field leaves the two copies
different, and nothing detects that. A changed script also invalidates the
cached snapshot, so the next session runs setup again.
