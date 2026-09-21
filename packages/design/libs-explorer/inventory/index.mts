/**
 * Everything the Explorer knows, assembled from the workspace at build time.
 *
 * The Nuxt module in `modules/explorer-inventory.ts` serialises the result into
 * a virtual module, so pages read one static object and nothing is fetched at
 * run time.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { NE_SHELL_COMPONENTS } from '../../narduk-shell/src/registry.ts'
import { CATALOG, type CatalogEntry } from './catalog.mts'
import { checkCoverage } from './check.mts'
import { EXAMPLES, type ExampleMeta } from './examples.mts'
import { parseTokens, type DesignToken } from './tokens.mts'
import { readWorkspacePackages, type WorkspacePackage } from './workspace.mts'

export type CatalogPackage = WorkspacePackage & CatalogEntry

export interface ExplorerInventory {
  packages: CatalogPackage[]
  examples: ExampleMeta[]
  tokens: DesignToken[]
  source: { commit: string | null; repository: string }
}

export const REPOSITORY_URL = 'https://github.com/narduk-enterprises/narduk-libs'

export const TOKEN_SOURCES = [
  'packages/design/narduk-ui/tokens.css',
  'packages/design/narduk-shell/theme.css',
] as const

const SHELL_CARDS_DIRECTORY = 'packages/design/narduk-shell/src/design-cards'

function basenames(directory: string, suffix: string): string[] {
  if (!existsSync(directory)) return []
  return readdirSync(directory)
    .filter((file) => file.endsWith(suffix))
    .map((file) => file.slice(0, -suffix.length))
    .sort()
}

function sourceCommit(repoRoot: string): string | null {
  const fromEnvironment = process.env.EXPLORER_SOURCE_COMMIT ?? process.env.GITHUB_SHA
  if (fromEnvironment) return fromEnvironment
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim()
  } catch {
    return null
  }
}

export function loadInventory(repoRoot: string, explorerRoot: string) {
  const packages = readWorkspacePackages(repoRoot)
  const problems = checkCoverage({
    packages,
    catalog: CATALOG,
    examples: EXAMPLES,
    shellComponents: NE_SHELL_COMPONENTS.map(({ name }) => name),
    cards: basenames(join(repoRoot, SHELL_CARDS_DIRECTORY), '.card.vue'),
    interactiveFiles: basenames(join(explorerRoot, 'app/examples'), '.vue'),
  })

  const inventory: ExplorerInventory = {
    packages: packages
      .filter((workspacePackage) => CATALOG[workspacePackage.name])
      .map((workspacePackage) => ({
        ...workspacePackage,
        ...(CATALOG[workspacePackage.name] as CatalogEntry),
      })),
    examples: [...EXAMPLES],
    tokens: TOKEN_SOURCES.flatMap((path) =>
      parseTokens(readFileSync(join(repoRoot, path), 'utf8'), path.replace('packages/design/', '')),
    ),
    source: { commit: sourceCommit(repoRoot), repository: REPOSITORY_URL },
  }
  return { inventory, problems }
}
