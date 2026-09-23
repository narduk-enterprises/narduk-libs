/**
 * `.github/actionlint.yaml` for an app whose workflows name self-hosted runner
 * labels (narduk-libs#778).
 *
 * The shared workflow's required `caller-lint` job runs actionlint over the
 * app's own `.github/workflows`, and actionlint's `runner-label` rule rejects
 * any label it does not know -- `proxmox`, `linux-ci` -- as a typo. Without
 * this file a freshly generated private app failed `ci / Caller lint` on its
 * first run (loadtest-dev#4, `dependabot-merge.yml: label "proxmox" is
 * unknown`).
 *
 * The labels are computed from the same arrays the `runs-on:` blocks are
 * written from, so the config declares exactly what the emitted workflows
 * name. `tests/toolchain-single-source.test.ts` re-runs the label check over
 * every emitted workflow and fails on a label this file does not declare.
 */

/**
 * The self-hosted labels actionlint (1.7) knows without configuration. Compared
 * case-insensitively, as actionlint does; anything else must be declared.
 */
const ACTIONLINT_BUILTIN_SELF_HOSTED_LABELS: ReadonlySet<string> = new Set([
  'self-hosted',
  'linux',
  'macos',
  'windows',
  'x64',
  'arm',
  'arm64',
])

/** The custom labels across `routes`, first-seen order, without built-ins or repeats. */
export function customRunnerLabels(routes: ReadonlyArray<readonly string[]>): string[] {
  const labels: string[] = []
  for (const label of routes.flat()) {
    if (ACTIONLINT_BUILTIN_SELF_HOSTED_LABELS.has(label.toLowerCase())) continue
    if (!labels.includes(label)) labels.push(label)
  }
  return labels
}

export function createActionlintConfig(labels: readonly string[]): string {
  return [
    '# actionlint configuration, read by the shared workflow caller-lint job.',
    '#',
    '# Declares the self-hosted runner labels this repository names in a',
    "# `runs-on:` block, so actionlint's runner-label rule does not reject",
    '# them as unknown. The labels themselves are defined by fleet, whose',
    '# organization runner manifest is the authority: add a label here only',
    '# when a workflow here names one fleet already routes.',
    'self-hosted-runner:',
    '  labels:',
    ...labels.map((label) => `    - ${label}`),
    '',
  ].join('\n')
}
