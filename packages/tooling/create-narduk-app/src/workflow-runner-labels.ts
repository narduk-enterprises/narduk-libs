import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'

import { parseDocument } from 'yaml'

import { createActionlintConfig, customRunnerLabels } from './actionlint-config.js'

// Exact hosted labels from actionlint v1.7.12's rule_runner_label.go.
// Unknown literal labels are retained even when they share a hosted prefix.
const HOSTED_RUNNER_LABELS: ReadonlySet<string> = new Set([
  'windows-latest',
  'windows-latest-8-cores',
  'windows-2025',
  'windows-2025-vs2026',
  'windows-2022',
  'windows-11-arm',
  'ubuntu-slim',
  'ubuntu-latest',
  'ubuntu-latest-4-cores',
  'ubuntu-latest-8-cores',
  'ubuntu-latest-16-cores',
  'ubuntu-24.04',
  'ubuntu-24.04-arm',
  'ubuntu-22.04',
  'ubuntu-22.04-arm',
  'macos-latest',
  'macos-latest-xlarge',
  'macos-latest-large',
  'macos-26-intel',
  'macos-26-xlarge',
  'macos-26-large',
  'macos-26',
  'macos-15-intel',
  'macos-15-xlarge',
  'macos-15-large',
  'macos-15',
  'macos-14-xlarge',
  'macos-14-large',
  'macos-14',
])

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function document(contents: string): Record<string, unknown> {
  const parsed = parseDocument(contents)
  if (parsed.errors.length) throw new Error('invalid YAML')
  const value: unknown = parsed.toJS({ maxAliasCount: 100 })
  const result = record(value)
  if (!result) throw new Error('expected a YAML mapping')
  return result
}

/** Reads local workflow routes only; never changes a workflow or runner route. */
export async function actionlintConfigForCheckout(
  targetDir: string,
  generatedConfig: string,
  workflowOverrides: ReadonlyMap<string, string>,
): Promise<{ contents: string } | { problem: string }> {
  const workflowDir = resolve(targetDir, '.github/workflows')
  let names: string[]
  try {
    names = (await readdir(workflowDir)).filter((name) => /\.ya?ml$/u.test(name))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    names = []
  }
  const paths = new Set(names.map((name) => '.github/workflows/' + name))
  for (const path of workflowOverrides.keys()) paths.add(path)
  // The scaffold also declares routes used by its opt-in migration templates.
  const defaults = record(document(generatedConfig)['self-hosted-runner'])?.labels
  const routes: string[][] = [Array.isArray(defaults) ? defaults.map(String) : []]
  for (const path of [...paths].sort()) {
    try {
      const contents =
        workflowOverrides.get(path) ?? (await readFile(resolve(targetDir, path), 'utf8'))
      const workflow = document(contents)
      const jobs = record(workflow.jobs)
      if (!jobs) throw new Error('expected a jobs mapping')
      for (const [name, value] of Object.entries(jobs)) {
        const job = record(value)
        if (!job) throw new Error('expected a job mapping for ' + name)
        const runsOn = job['runs-on']
        if (runsOn === undefined && typeof job.uses === 'string') continue
        const runner = record(runsOn)
        if (runner && runner.labels === undefined && typeof runner.group === 'string') continue
        const labels: unknown = runner ? runner.labels : runsOn
        const route = typeof labels === 'string' ? [labels] : labels
        if (
          !Array.isArray(route) ||
          !route.length ||
          !route.every(
            (label): label is string => typeof label === 'string' && label.trim().length > 0,
          )
        ) {
          throw new Error('cannot infer literal runner labels for job ' + name)
        }
        if (route.some((label) => label.includes('${{'))) {
          throw new Error('dynamic runner labels for job ' + name)
        }
        // Hosted runner labels need no self-hosted declaration. An explicit
        // self-hosted route may legitimately include a hosted-looking label.
        const selfHosted = route.some((label) => label.toLowerCase() === 'self-hosted')
        routes.push(
          selfHosted
            ? route
            : route.filter((label) => !HOSTED_RUNNER_LABELS.has(label.toLowerCase())),
        )
      }
    } catch (error) {
      return {
        problem:
          path +
          ': ' +
          (error instanceof Error ? error.message : 'cannot read workflow runner labels'),
      }
    }
  }
  return { contents: createActionlintConfig(customRunnerLabels(routes)) }
}
