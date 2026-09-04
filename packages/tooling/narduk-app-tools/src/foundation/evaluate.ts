/**
 * Orchestrates all seven §4 items into one `foundation-check.json` artefact.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { evaluateItem1 } from './items/item-1-scaffold-parity.js'
import { evaluateItem2 } from './items/item-2-mandatory-packages.js'
import { evaluateItem3 } from './items/item-3-capability-packages.js'
import { evaluateItem4 } from './items/item-4-no-forks.js'
import { evaluateItem5 } from './items/item-5-shared-ci.js'
import { evaluateItem6 } from './items/item-6-secrets-and-registry.js'
import { evaluateItem7 } from './items/item-7-recorded-exemption.js'
import { FilesystemRegistryReality, type RegistryReality } from './npm-registry.js'
import { buildArtefact, itemResult } from './schema.js'
import { AppRepo, isRecord, parseJson } from './source.js'
import type { FoundationAppInfo, FoundationCheckArtefact } from './types.js'

function gitOutput(root: string, args: string[]): string | null {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
  } catch {
    return null
  }
}

const UNKNOWN_COMMIT = '0'.repeat(40)

export function resolveAppInfo(
  root: string,
  overrides: Partial<FoundationAppInfo> = {},
): FoundationAppInfo {
  const packageJson = parseJson(
    (() => {
      try {
        return readFileSync(join(root, 'package.json'), 'utf8')
      } catch {
        return null
      }
    })(),
  )
  const cfApp = parseJson(
    (() => {
      try {
        return readFileSync(join(root, 'Config', 'cloudflare-app.json'), 'utf8')
      } catch {
        return null
      }
    })(),
  )
  const repoFromConfig =
    isRecord(cfApp) && isRecord(cfApp.product) && typeof cfApp.product.repository === 'string'
      ? cfApp.product.repository
      : undefined
  const envRepo = process.env.GITHUB_REPOSITORY
  const commit = gitOutput(root, ['rev-parse', 'HEAD']) ?? process.env.GITHUB_SHA ?? UNKNOWN_COMMIT
  const ref =
    gitOutput(root, ['symbolic-ref', '-q', 'HEAD']) ??
    process.env.GITHUB_REF ??
    'refs/heads/unknown'
  const name =
    isRecord(packageJson) && typeof packageJson.name === 'string'
      ? packageJson.name
      : (root.split('/').pop() ?? 'app')
  return {
    repo: overrides.repo ?? envRepo ?? repoFromConfig ?? 'unknown/unknown',
    name: overrides.name ?? name,
    commit: overrides.commit ?? commit,
    ref: overrides.ref ?? ref,
  }
}

export interface RunFoundationCheckOptions {
  root: string
  toolVersion: string
  reality?: RegistryReality
  appOverrides?: Partial<FoundationAppInfo>
  generated?: string
}

export async function runFoundationCheck(
  options: RunFoundationCheckOptions,
): Promise<FoundationCheckArtefact> {
  const repo = new AppRepo(options.root)
  const reality = options.reality ?? new FilesystemRegistryReality(options.root)

  const items = [
    itemResult(1, evaluateItem1(repo)),
    itemResult(2, await evaluateItem2(repo, reality)),
    itemResult(3, evaluateItem3(repo)),
    itemResult(4, evaluateItem4(repo)),
    itemResult(5, evaluateItem5(repo)),
    itemResult(6, evaluateItem6(repo)),
    itemResult(7, evaluateItem7()),
  ]

  return buildArtefact({
    toolVersion: options.toolVersion,
    app: resolveAppInfo(options.root, options.appOverrides),
    items,
    generated: options.generated,
  })
}
