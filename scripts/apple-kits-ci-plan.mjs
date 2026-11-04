import { appendFileSync } from 'node:fs'
import { changedFilesBetween } from './compute-affected-packages.mjs'

// The Apple kits (NardukAppKit, NardukUpdateKit, NardukActivityKit) are
// SwiftPM-only and macOS-hosted, so they have their own job. It runs when their
// sources, the shared SwiftPM manifest, or their own CI wiring change.
const args = process.argv.slice(2)
const files = args[0] === '--all' ? null : changedFilesBetween(process.cwd(), args[1], args[3])
const enabled =
  files === null ||
  files.some(
    (path) =>
      path.startsWith('packages/apple/') ||
      /^Package\.(swift|resolved)$/.test(path) ||
      /^\.github\/workflows\/(ci|apple-kits-swift)\.yml$/.test(path) ||
      path === 'scripts/apple-kits-ci-plan.mjs',
  )
if (process.env.GITHUB_OUTPUT)
  appendFileSync(process.env.GITHUB_OUTPUT, `apple-kits-swift=${enabled}\n`)
console.log(`Apple kits Swift gate: ${enabled}`)
