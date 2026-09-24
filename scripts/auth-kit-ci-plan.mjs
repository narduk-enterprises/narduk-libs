import { appendFileSync } from 'node:fs'
import { changedFilesBetween } from './compute-affected-packages.mjs'

// NardukAuthKit is Apple-only, so it has its own macOS job instead of joining
// the Linux logging-languages gate. It runs when its sources, the shared
// SwiftPM manifest, or its own CI wiring change.
const args = process.argv.slice(2)
const files = args[0] === '--all' ? null : changedFilesBetween(process.cwd(), args[1], args[3])
const enabled =
  files === null ||
  files.some(
    (path) =>
      path.startsWith('packages/modules/narduk-auth/swift/') ||
      /^Package\.(swift|resolved)$/.test(path) ||
      /^\.github\/workflows\/(ci|auth-kit-swift)\.yml$/.test(path) ||
      path === 'scripts/auth-kit-ci-plan.mjs',
  )
if (process.env.GITHUB_OUTPUT)
  appendFileSync(process.env.GITHUB_OUTPUT, `auth-kit-swift=${enabled}\n`)
console.log(`NardukAuthKit Swift gate: ${enabled}`)
