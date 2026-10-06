import { appendFileSync } from 'node:fs'
import { changedFilesBetween } from './compute-affected-packages.mjs'

// NardukMusic has its own Linux and macOS jobs (narduk-music-swift.yml). They
// run when its sources, the shared SwiftPM manifest, the Linux Swift installer
// or its own CI wiring change.
const args = process.argv.slice(2)
const files = args[0] === '--all' ? null : changedFilesBetween(process.cwd(), args[1], args[3])
const enabled =
  files === null ||
  files.some(
    (path) =>
      path.startsWith('packages/modules/narduk-music/') ||
      /^(Package\.(swift|resolved)|\.swift-format)$/.test(path) ||
      /^\.github\/workflows\/(ci|narduk-music-swift)\.yml$/.test(path) ||
      path === 'scripts/narduk-music-ci-plan.mjs' ||
      path === 'scripts/install-swift-linux.py',
  )
if (process.env.GITHUB_OUTPUT)
  appendFileSync(process.env.GITHUB_OUTPUT, `narduk-music-swift=${enabled}\n`)
console.log(`NardukMusic Swift gate: ${enabled}`)
