/**
 * The Explorer's coverage check.
 *
 * Pure: it takes the facts and returns every problem as a message that names
 * the fix. `index.mts` feeds it the real workspace, the Nuxt module refuses to
 * build while it returns anything, and `check.test.mts` proves each rule both
 * ways.
 */
import type { CatalogEntry } from './catalog.mts'
import type { ExampleMeta } from './examples.mts'
import type { WorkspacePackage } from './workspace.mts'

export interface CoverageFacts {
  packages: readonly WorkspacePackage[]
  catalog: Readonly<Record<string, CatalogEntry>>
  examples: readonly ExampleMeta[]
  /** Every component name `narduk-shell` registers. */
  shellComponents: readonly string[]
  /** Design card basenames present on disk. */
  cards: readonly string[]
  /** `app/examples/<id>.vue` basenames present on disk. */
  interactiveFiles: readonly string[]
  /**
   * `app/usage/*.vue` basenames present on disk, without `.vue`. A usage file
   * is `<id>.usage.vue`: were it `<id>.vue`, `<NePager>` inside `ne-pager.vue`
   * would resolve to the file itself (an SFC may refer to itself by file name)
   * and the typecheck would never see the real component's props.
   */
  usageFiles: readonly string[]
}

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function checkCoverage(facts: CoverageFacts): string[] {
  const problems: string[] = []
  const packageNames = new Set(facts.packages.map(({ name }) => name))
  const exampleIds = new Set<string>()

  for (const workspacePackage of facts.packages) {
    if (!facts.catalog[workspacePackage.name]) {
      problems.push(
        `${workspacePackage.name} (${workspacePackage.directory}) has no catalog entry: add one to inventory/catalog.mts.`,
      )
    }
  }

  const slugs = new Map<string, string>()
  for (const workspacePackage of facts.packages) {
    const owner = slugs.get(workspacePackage.slug)
    if (owner) {
      problems.push(
        `${workspacePackage.name} and ${owner} share the URL slug "${workspacePackage.slug}".`,
      )
    }
    slugs.set(workspacePackage.slug, workspacePackage.name)
  }

  for (const example of facts.examples) {
    if (!ID_PATTERN.test(example.id)) {
      problems.push(`Example id "${example.id}" is not lower-case kebab-case.`)
    }
    if (exampleIds.has(example.id)) problems.push(`Example id "${example.id}" is registered twice.`)
    exampleIds.add(example.id)
    if (!packageNames.has(example.package)) {
      problems.push(
        `Example "${example.id}" names ${example.package}, which is not in the workspace.`,
      )
    }
    if (example.card && !facts.cards.includes(example.card)) {
      problems.push(
        `Example "${example.id}" names the design card ${example.card}.card.vue, which does not exist.`,
      )
    }
    if (!example.card && !example.interactive) {
      problems.push(`Example "${example.id}" has neither a design card nor an interactive demo.`)
    }
    if (example.interactive && !facts.interactiveFiles.includes(example.id)) {
      problems.push(
        `Example "${example.id}" is interactive but app/examples/${example.id}.vue is missing.`,
      )
    }
  }

  const byId = new Map(facts.examples.map((example) => [example.id, example]))
  for (const file of facts.interactiveFiles) {
    const example = byId.get(file)
    if (!example) {
      problems.push(`app/examples/${file}.vue has no entry in inventory/examples.mts.`)
    } else if (!example.interactive) {
      problems.push(
        `app/examples/${file}.vue exists but example "${file}" is not marked interactive, so the demo would never render: set interactive: true in inventory/examples.mts, or delete the file.`,
      )
    }
  }

  for (const example of facts.examples) {
    if (!facts.usageFiles.includes(`${example.id}.usage`)) {
      problems.push(
        `Example "${example.id}" has no usage source: add app/usage/${example.id}.usage.vue, a complete example that typechecks against the real API.`,
      )
    }
  }
  for (const file of facts.usageFiles) {
    const id = file.endsWith('.usage') ? file.slice(0, -'.usage'.length) : null
    if (id === null) {
      problems.push(
        `app/usage/${file}.vue is not named <id>.usage.vue: rename it, so the typecheck resolves the real component rather than the file itself.`,
      )
    } else if (!byId.has(id)) {
      problems.push(`app/usage/${file}.vue has no entry in inventory/examples.mts.`)
    }
  }

  const covered = new Set(facts.examples.map(({ component }) => component).filter(Boolean))
  for (const component of facts.shellComponents) {
    if (!covered.has(component)) {
      problems.push(
        `narduk-shell registers ${component} but no example covers it: add one to inventory/examples.mts.`,
      )
    }
  }

  for (const [name, entry] of Object.entries(facts.catalog)) {
    if (!packageNames.has(name)) {
      problems.push(
        `inventory/catalog.mts has an entry for ${name}, which is not in the workspace.`,
      )
    }
    if (entry.capabilities.length === 0) problems.push(`${name} lists no capabilities.`)
    for (const demo of entry.demos ?? []) {
      if (!exampleIds.has(demo)) {
        problems.push(`${name} links the demo "${demo}", which is not in inventory/examples.mts.`)
      }
    }
    const workspacePackage = facts.packages.find((candidate) => candidate.name === name)
    for (const [field, specifier] of [
      ['nuxtModule', entry.setup?.nuxtModule],
      ['stylesheet', entry.setup?.stylesheet],
    ] as const) {
      if (!specifier || !workspacePackage) continue
      const subpath = specifier === name ? '.' : `.${specifier.slice(name.length)}`
      if (!specifier.startsWith(name) || !workspacePackage.exports.includes(subpath)) {
        problems.push(
          `${name} setup.${field} "${specifier}" is not the package or one of its exports: update inventory/catalog.mts.`,
        )
      }
    }
  }

  return problems
}
