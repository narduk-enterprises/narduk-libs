import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * `narduk-app deploy` refuses to publish an `.output` holding this file
 * (narduk-app-tools `BUILD_CI_OUTPUT_MARKER`). narduk-seo does not depend on
 * narduk-app-tools, so the name is repeated here; a test fails if the two drift.
 */
export const BUILD_CI_OUTPUT_MARKER = '.narduk-build-ci'

export const BUILD_CI_OUTPUT_MARKER_BODY =
  'narduk-seo: NUXT_OG_IMAGE_SECRET is the public test-only placeholder\n'

/**
 * Mark a Nitro output that was signed with the test-only OG placeholder, so
 * no deploy path can publish it, whichever script built it (narduk-libs#1155).
 */
export function writeBuildCiOutputMarker(outputDir: string): string {
  mkdirSync(outputDir, { recursive: true })
  const path = join(outputDir, BUILD_CI_OUTPUT_MARKER)
  writeFileSync(path, BUILD_CI_OUTPUT_MARKER_BODY, 'utf8')
  return path
}
