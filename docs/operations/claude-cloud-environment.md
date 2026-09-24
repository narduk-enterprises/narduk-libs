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

1. The estate baseline. The script clones agent-infrastructure to
   `~/.local/share/agent-infrastructure` and runs its
   `scripts/claude-cloud-env-setup.sh`. That gives Node 24, pnpm through
   corepack, shellcheck, PyYAML and the estate `AGENTS.md` imported from
   `~/.claude/CLAUDE.md`.
2. uv, at the version `logging-languages.yml` pins, for the narduk-logging
   Python quality gate.
3. A warm `pnpm install --frozen-lockfile` when the repo is already on disk. It
   also adds a user-level `SessionStart` hook that installs when `node_modules`
   is missing.
4. Playwright Chromium and its system libraries, installed with
   `pnpm exec playwright install --with-deps chromium` as `ci.yml` does. The
   lockfile sets the version, so there is no separate pin to keep in sync.

Steps 3 and 4 are capped at 120 seconds each. A step that times out is skipped,
and the session can run the same command itself.

The Swift toolchain is not installed. It is about 1 GB and does not fit the
setup budget of about 5 minutes. Run `python3 scripts/install-swift-linux.py`
inside a session when you need the narduk-logging Swift gate.

## Changing the script

The repository file is the reviewed source. After it merges, open the gear icon
beside the environment name at claude.ai/code and paste the whole file into the
Setup script field again. Editing only the field leaves the two copies
different, and nothing detects that. A changed script also invalidates the
cached snapshot, so the next session runs setup again.
