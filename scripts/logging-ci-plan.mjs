import { appendFileSync } from 'node:fs'
import { changedFilesBetween } from './compute-affected-packages.mjs'

const args = process.argv.slice(2)
const files = args[0] === '--all' ? null : changedFilesBetween(process.cwd(), args[1], args[3])
const enabled =
  files === null ||
  files.some(
    (path) =>
      path.startsWith('packages/modules/narduk-logging/') ||
      /^(Package\.(swift|resolved)|\.swiftlint\.yml|\.swift-format)$/.test(path) ||
      /^\.github\/workflows\/(ci|logging-languages)\.yml$/.test(path) ||
      /^scripts\/(install-swift-linux\.py|logging-ci-plan\.mjs)$/.test(path),
  )
if (process.env.GITHUB_OUTPUT)
  appendFileSync(process.env.GITHUB_OUTPUT, `logging-languages=${enabled}\n`)
console.log(`Logging language gates: ${enabled}`)
