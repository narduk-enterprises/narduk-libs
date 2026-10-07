import { appendFileSync } from 'node:fs'
import { changedFilesBetween } from './compute-affected-packages.mjs'

// NardukMusic has its own Linux and macOS jobs (narduk-music-swift.yml). They
// run when its sources, the shared SwiftPM manifest, the Linux Swift installer
// or its own CI wiring change.
//
// Inside the gate, a pull request (`--scope-apps`) only pays for the Apple
// steps its diff can change. Linux is always the full gate for the modules it
// builds. A push to main, a release and `--all` run every step, so a scoped
// pull request is always backed by a full run before and after it merges.
//   macos       the macOS job: any narduk-music file that is not documentation
//   ios-device  the iOS device build loop: a product Linux cannot build changed
//   gallery     SoundGallery for macOS and the iOS simulator
//   blaster     Beat Blaster's simulator tests
const args = process.argv.slice(2)
const scoped = args.includes('--scope-apps')
const rest = args.filter((arg) => arg !== '--scope-apps')
const files = rest[0] === '--all' ? null : changedFilesBetween(process.cwd(), rest[1], rest[3])

const music = 'packages/modules/narduk-music/swift/'
const inEnabledSet = (path) =>
  path.startsWith('packages/modules/narduk-music/') ||
  /^(Package\.(swift|resolved)|\.swift-format)$/.test(path) ||
  /^\.github\/workflows\/(ci|narduk-music-swift)\.yml$/.test(path) ||
  path === 'scripts/narduk-music-ci-plan.mjs' ||
  path === 'scripts/install-swift-linux.py'
const isDocumentation = (path) =>
  path.startsWith('packages/modules/narduk-music/') &&
  (path.endsWith('.md') || path.startsWith(`${music}docs/`))
// Wiring that can change what any Apple step does.
const isWiring = (path) => !path.startsWith('packages/modules/narduk-music/') && inEnabledSet(path)
const inSources = (path, targets) =>
  targets.some((target) => path.startsWith(`${music}Sources/${target}/`))
const inApp = (path, app) => path.startsWith(`${music}Apps/${app}/`)

const enabled = files === null || files.some(inEnabledSet)
const every = !scoped || files === null
const touches = (test) => enabled && (every || files.some((path) => isWiring(path) || test(path)))
const outputs = {
  'narduk-music-swift': enabled,
  'narduk-music-macos':
    enabled && (every || files.some((path) => inEnabledSet(path) && !isDocumentation(path))),
  'narduk-music-ios-device': touches((path) =>
    inSources(path, [
      'NardukMusicEngine',
      'NardukSoundAnalysis',
      'NardukSonify',
      'NardukSoundVisuals',
    ]),
  ),
  'narduk-music-gallery': touches(
    (path) =>
      inApp(path, 'SoundGallery') ||
      inSources(path, ['NardukSoundVisuals', 'NardukSoundAnalysis', 'NardukMusicEngine']),
  ),
  'narduk-music-blaster': touches(
    (path) =>
      inApp(path, 'BeatBlaster') || inSources(path, ['NardukMusicEngine', 'NardukSoundVisuals']),
  ),
}
const lines = Object.entries(outputs).map(([name, value]) => `${name}=${value}\n`)
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, lines.join(''))
console.log(`NardukMusic Swift gate: ${enabled}`)
for (const [name, value] of Object.entries(outputs).slice(1)) console.log(`  ${name}: ${value}`)
