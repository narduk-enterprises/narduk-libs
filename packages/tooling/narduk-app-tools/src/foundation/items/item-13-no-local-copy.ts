/**
 * Item 13 -- no-local-copy (components-library-plan.md §2 item 13,
 * narduk-libs#260; numbered 13 because 9-12 were taken first).
 *
 * The repository half of `narduk/no-shadowed-shared-component`: an app-local
 * component whose name matches one a shared package publishes is a local copy.
 * The fix belongs upstream (company-hq `docs/NARDUK-APP-COMPLIANCE.md` §3.9).
 *
 * One sub-check per owning package, decided from the app's own files:
 *
 *   - the package is a dependency and a component under a `components/`
 *     directory carries one of its names -> FAIL, naming each file;
 *   - the package is a dependency and nothing matches -> PASS;
 *   - the package is not a dependency -> N/A. A same-named file then shadows
 *     nothing installed; the detail lists it so a reviewer can still see it.
 *
 * A name matches on either the file name or the name Nuxt registers from the
 * path, the same two names the lint rule checks. An app with no UI surface is
 * N/A in full, like item 8.
 */

import { check } from '../schema.js'
import {
  SHARED_COMPONENT_OWNERS,
  nuxtComponentName,
  type SharedComponentOwner,
} from '../shared-components.js'
import {
  NUXT_UI_SURFACE_CANDIDATES,
  collectPackages,
  hasNuxtUiSurface,
  mergedDeps,
  type AppRepo,
} from '../source.js'
import { STATUS_FAIL, STATUS_NA, STATUS_PASS, type FoundationSubCheck } from '../types.js'

export const NO_LOCAL_COPY_ITEM_ID = 13
export const NO_LOCAL_COPY_ITEM_NAME = 'no-local-copy'

const COMPONENT_DIRS = NUXT_UI_SURFACE_CANDIDATES.filter((rel) => rel.endsWith('components'))

interface LocalMatch {
  file: string
  name: string
}

/** Every app-local component file whose name belongs to `owner`. */
function localCopies(repo: AppRepo, owner: SharedComponentOwner): LocalMatch[] {
  const names = new Set(owner.names)
  const matches: LocalMatch[] = []
  for (const dir of COMPONENT_DIRS) {
    for (const file of repo.walk(dir, ['.vue'])) {
      const relativePath = file.slice(dir.length + 1)
      const baseName = (relativePath.split('/').at(-1) ?? '').replace(/\.vue$/, '')
      const name = [baseName, nuxtComponentName(relativePath)].find((c) => names.has(c))
      if (name) matches.push({ file, name })
    }
  }
  return matches
}

function describeMatches(matches: readonly LocalMatch[]): string {
  return matches.map((match) => `${match.file} (${match.name})`).join(', ')
}

export function evaluateItem13(repo: AppRepo): FoundationSubCheck[] {
  if (!hasNuxtUiSurface(repo)) {
    return [
      check(
        '13.1',
        'app has UI',
        STATUS_NA,
        'no Nuxt pages or components directory -- nothing can copy a shared component',
      ),
    ]
  }

  const deps = mergedDeps(collectPackages(repo))
  return SHARED_COMPONENT_OWNERS.map((owner, index) => {
    const id = `13.${index + 1}`
    const short = owner.pkg.slice(owner.pkg.indexOf('/') + 1)
    const name = `no app-local copy of a ${short} component`
    const matches = localCopies(repo, owner)

    if (deps[owner.pkg] === undefined) {
      const tail =
        matches.length > 0
          ? `; ${matches.length} app-local file(s) share a name but shadow nothing installed: ${describeMatches(matches)}`
          : ''
      return check(id, name, STATUS_NA, `${owner.pkg} is not a dependency${tail}`)
    }
    if (matches.length > 0) {
      return check(
        id,
        name,
        STATUS_FAIL,
        `${matches.length} app-local component(s) copy ${owner.pkg}: ${describeMatches(matches)} -- ` +
          'use the shared component, or fix or extend it in narduk-libs',
      )
    }
    return check(id, name, STATUS_PASS, `no app-local component shares a ${owner.pkg} name`)
  })
}
