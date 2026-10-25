/**
 * The install policy of every generated GitHub job: one fresh pnpm store per
 * job, kept for every later and nested install, then a frozen-lockfile install.
 *
 * agent-infrastructure#3549: a persistent runner's shared pnpm store can hand a
 * job a package whose files differ from the locked artifact, and the job only
 * finds out when a deploy-time CLI fails to start. A store the job creates
 * itself cannot carry such a copy. The store is a job-level choice, not a
 * first-install flag: `cf:build` runs its own `pnpm install --frozen-lockfile`
 * inside the build, and without a job-wide setting that install returns to the
 * persistent store.
 *
 * The mechanism is the `NPM_CONFIG_STORE_DIR` environment variable, written to
 * `$GITHUB_ENV` so every later step and every nested pnpm inherits it. Measured
 * on the pinned pnpm (10.33.4): it beats a committed `.npmrc` `store-dir` and a
 * user config, and a `--store-dir` flag beats it. A `storeDir` in
 * `pnpm-workspace.yaml` beats the variable, which is why the install step
 * asserts the effective store before it installs rather than trusting the
 * variable. The generator emits neither; an app that adds one fails closed.
 *
 * The directory comes from `mktemp -d` under `$RUNNER_TEMP`, so two jobs on one
 * runner, a matrix, and a re-run all get different stores. Nothing here
 * deletes or edits the runner's own store: it is only not used. A lane's normal
 * worktree install keeps its shared default; this applies to generated jobs.
 */

/** The variable pnpm reads for `store-dir`. */
export const JOB_PNPM_STORE_ENV = 'NPM_CONFIG_STORE_DIR'

export const JOB_PNPM_STORE_STEP_NAME = 'Create a fresh job-owned pnpm store'

/** The one install every generated job runs: the lockfile, never a resolve. */
export const FROZEN_INSTALL_COMMAND = 'pnpm install --frozen-lockfile'

/** Shell that creates this job's store and exports it to every later step. */
export const JOB_PNPM_STORE_SCRIPT = [
  'set -euo pipefail',
  'store="$(mktemp -d "$RUNNER_TEMP/pnpm-store.XXXXXX")"',
  `printf '${JOB_PNPM_STORE_ENV}=%s\\n' "$store" >> "$GITHUB_ENV"`,
] as const

/**
 * Shell that refuses to install unless pnpm will really use the job's store.
 * `pnpm store path` appends the store version directory, hence the `/*`.
 */
export const JOB_PNPM_STORE_ASSERT_SCRIPT = [
  `test -n "\${${JOB_PNPM_STORE_ENV}:-}"`,
  `case "$(pnpm store path)" in "$${JOB_PNPM_STORE_ENV}"/*) ;; *)`,
  `  echo "::error::pnpm resolves a store outside the job-owned $${JOB_PNPM_STORE_ENV} (check pnpm-workspace.yaml storeDir); refusing to install from a shared store."`,
  '  exit 1 ;;',
  'esac',
] as const

export interface CliStartupSmoke {
  /** Step name. */
  readonly name: string
  /** Directory the next real step runs `pnpm exec` from. */
  readonly workingDirectory: string
  /** A command that loads the CLI module graph and exits 0 (for example `--help`). */
  readonly command: string
}

export interface InstallPolicyOptions {
  /** Name of the frozen install step. */
  readonly installName: string
  /**
   * Run right after the install, so a CLI that cannot start fails here and not
   * in the migration or promotion step that needs it. Only name a command whose
   * package the generated app really depends on.
   */
  readonly smoke?: CliStartupSmoke
}

function block(indent: string, lines: readonly string[]): string[] {
  return lines.map((line) => `${indent}${line}`)
}

/**
 * The steps that follow checkout, `pnpm/action-setup` and `actions/setup-node`:
 * the job store, the frozen install, and the optional CLI startup proof. Lines
 * are indented as items of a job's `steps:` (six spaces).
 */
export function installPolicySteps(options: InstallPolicyOptions): string[] {
  const lines = [
    `      - name: ${JOB_PNPM_STORE_STEP_NAME}`,
    '        run: |',
    ...block('          ', JOB_PNPM_STORE_SCRIPT),
    `      - name: ${options.installName}`,
    '        run: |',
    ...block('          ', [...JOB_PNPM_STORE_ASSERT_SCRIPT, FROZEN_INSTALL_COMMAND]),
  ]
  if (options.smoke) {
    lines.push(
      `      - name: ${options.smoke.name}`,
      `        working-directory: ${options.smoke.workingDirectory}`,
      `        run: ${options.smoke.command}`,
    )
  }
  return lines
}
