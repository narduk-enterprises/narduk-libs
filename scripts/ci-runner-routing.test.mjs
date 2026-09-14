import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'

const jobs = (filename) => {
  const source = readFileSync(new URL(`../.github/workflows/${filename}`, import.meta.url), 'utf8')
  const body = source.split('\njobs:\n')[1]
  assert.ok(body, `${filename} must declare jobs`)
  return Object.fromEntries(
    [...body.matchAll(/^  ([\w-]+):\s*$/gm)].map((match, index, matches) => [
      match[1],
      body.slice(match.index, matches[index + 1]?.index),
    ]),
  )
}

const ci = jobs('ci.yml')
const languages = jobs('logging-languages.yml')
const linuxJobs = { contracts: ci.contracts, ...languages }
const selfHosted = {
  group: 'linux-ci',
  labels: ['self-hosted', 'Linux', 'X64', 'proxmox', 'linux-ci'],
}

// Execute the shipped expressions' boolean/string subset with the two Actions
// functions they use. No runner-selection decision is reimplemented here.
const route = (source, vars) => {
  const expression = source.match(/^    runs-on: \$\{\{ (.+) \}\}$/m)?.[1]
  assert.ok(expression, 'every local Linux gate must honor the overflow switch')
  return runInNewContext(expression, {
    vars,
    fromJSON: JSON.parse,
    format: (pattern, value) => pattern.replace('{0}', value),
  })
}

test('preflight and language gates honor the same persistent package overflow switch', () => {
  for (const source of Object.values(linuxJobs)) {
    assert.equal(
      route(source, { BLACKSMITH_RUNNERS_ENABLED: 'true' }),
      'blacksmith-2vcpu-ubuntu-2404',
    )
    assert.equal(
      route(source, {
        BLACKSMITH_RUNNERS_ENABLED: 'true',
        BLACKSMITH_LINUX_LABEL: 'blacksmith-4vcpu-ubuntu-2404',
      }),
      'blacksmith-4vcpu-ubuntu-2404',
    )
    for (const value of [undefined, '', 'false', 'invalid']) {
      assert.deepEqual(
        route(source, {
          BLACKSMITH_RUNNERS_ENABLED: value,
          BLACKSMITH_LINUX_LABEL: 'blacksmith-4vcpu-ubuntu-2404',
        }),
        selfHosted,
      )
    }
  }
})

test('Linux overflow leaves browser gates on their isolated runner class', () => {
  for (const name of ['packed-consumer-smoke', 'package-browser-tests']) {
    assert.match(ci[name], /^    runs-on:\n      group: playwright-isolated\n/m)
    assert.doesNotMatch(ci[name], /BLACKSMITH_/)
  }
})
