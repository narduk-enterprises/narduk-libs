#!/usr/bin/env node
/**
 * Write the temporary GitHub Packages read credential that `pnpm install`
 * needs to resolve this workspace's private `@narduk-enterprises/*`
 * dependencies (root devDependency `@narduk-enterprises/eslint-config`, and
 * anything the generated-consumer smoke pulls).
 *
 * WHY THIS FILE EXISTS AS A SCRIPT rather than an inline heredoc in a
 * workflow: the shared CI gate
 * (narduk-enterprises/workflows/.github/workflows/node-library.yml@v1, adopted
 * for company-hq#278 / D-WF-1) bootstraps registry auth by looking for
 * `./scripts/package-registry-auth.mjs` -- and falling back to
 * `./tools/configure-package-registry-auth.mjs` -- then skipping cleanly when
 * neither exists. narduk-libs CANNOT skip: its install 401s without a token,
 * so the callable's convention path has to be present. This file is that
 * path, and `.github/workflows/ci.yml`'s own contracts and consumer-smoke
 * jobs call it too, so the credential file has exactly one definition.
 *
 * The token is read from the environment and never printed. The file is
 * written with owner-only permissions and is already covered by .gitignore.
 */
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const token = process.env.GH_PACKAGES_READ

if (!token) {
  process.stderr.write(
    'GH_PACKAGES_READ is empty; refusing to write an unauthenticated .npmrc.auth.\n',
  )
  process.exit(1)
}

// The shared workflow points NPM_CONFIG_USERCONFIG at
// `<workspace>/<working-directory>/.npmrc.auth`, and runs this script with the
// same working directory as its cwd -- so writing relative to cwd lands on the
// exact file the install steps will read.
const target = resolve(process.cwd(), '.npmrc.auth')

writeFileSync(
  target,
  [
    '@narduk-enterprises:registry=https://npm.pkg.github.com',
    '@narduk-geo:registry=https://npm.pkg.github.com',
    `//npm.pkg.github.com/:_authToken=${token}`,
    '',
  ].join('\n'),
  { mode: 0o600 },
)

process.stdout.write(`wrote package registry auth to ${target}\n`)
