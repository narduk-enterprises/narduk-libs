import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  dependabotMatchesRegistry,
  detectPackageRegistry,
  githubPackagesDependabot,
  hasExplicitZeroCooldown,
  hasNpmUpdateBlock,
} from '../src/dependabot-registry.js'
import { createNardukApp, upgradeNardukApp } from '../src/index.js'

const PLACEHOLDER = 'NPM_NARD_UK_PLACEHOLDER'
const tempDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

async function checkout(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'create-narduk-dependabot-'))
  tempDirectories.push(directory)
  return directory
}

async function write(directory: string, path: string, contents: string): Promise<void> {
  await mkdir(join(directory, path, '..'), { recursive: true })
  await writeFile(join(directory, path), contents, 'utf8')
}

const githubWorking = [
  'version: 2',
  'registries:',
  '  npm-github:',
  '    type: npm-registry',
  '    url: https://npm.pkg.github.com',
  '    token: ${{secrets.NARDUK_PLATFORM_GH_PACKAGES_READ}}',
  "    scope: '@narduk-enterprises'",
  'updates:',
  "  - package-ecosystem: 'npm'",
  "    directory: '/'",
  '    registries:',
  '      - npm-github',
  '    open-pull-requests-limit: 2',
  '    cooldown:',
  '      default-days: 0',
  '    groups:',
  '      safe:',
  '        patterns:',
  "          - '*'",
  '        update-types:',
  "          - 'minor'",
  "          - 'patch'",
  '      majors:',
  '        patterns:',
  "          - '*'",
  '        update-types:',
  "          - 'major'",
  '    ignore:',
  "      - dependency-name: 'typescript'",
  "        versions: ['>=7.0.0']",
  '',
].join('\n')

const mirrorWorking = [
  '# mentions npm.pkg.github.com only as history, not as a registry entry',
  'version: 2',
  'registries:',
  '  npm-nard-uk:',
  '    type: npm-registry',
  '    url: https://npm.nard.uk',
  '    token: ${{secrets.NPM_NARD_UK_PLACEHOLDER}}',
  'updates:',
  '  - package-ecosystem: "npm"',
  '    directory: "/"',
  '    registries:',
  '      - npm-nard-uk',
  '    open-pull-requests-limit: 1',
  '    cooldown:',
  '      default-days: 0',
  '      semver-major-days: 0',
  '    groups:',
  '      dependencies:',
  '        patterns:',
  '          - "*"',
  '',
].join('\n')

describe('package registry detection', () => {
  it('prefers .npmrc over the lockfile', () => {
    expect(
      detectPackageRegistry(
        '@narduk-enterprises:registry=https://npm.pkg.github.com\n',
        'tarball: https://npm.nard.uk/x\n',
      ),
    ).toBe('github-packages')
    expect(detectPackageRegistry('@narduk-enterprises:registry=https://npm.nard.uk\n', null)).toBe(
      'narduk-mirror',
    )
    expect(detectPackageRegistry(null, 'https://npm.pkg.github.com/download/x\n')).toBe(
      'github-packages',
    )
    expect(detectPackageRegistry(null, null)).toBe('unknown')
    expect(detectPackageRegistry('registry=https://npm.pkg.github.com\n', null)).toBe(
      'github-packages',
    )
    expect(
      detectPackageRegistry(
        'registry=https://registry.npmjs.org\n@narduk-enterprises:registry=https://npm.pkg.github.com\n',
        null,
      ),
    ).toBe('github-packages')
    expect(detectPackageRegistry(null, 'https://evil.example/npm.pkg.github.com\n')).toBe('unknown')
    expect(detectPackageRegistry(null, 'https://not-npm.pkg.github.com/download/x\n')).toBe(
      'unknown',
    )
    expect(detectPackageRegistry(null, 'https://npm.nard.uk.evil.example/x\n')).toBe('unknown')
  })

  it('treats cooldown 0 plus the matching registry as already working', () => {
    expect(hasExplicitZeroCooldown(githubWorking)).toBe(true)
    expect(dependabotMatchesRegistry(githubWorking, 'github-packages')).toBe(true)
    expect(dependabotMatchesRegistry(githubWorking, 'narduk-mirror')).toBe(false)
    expect(dependabotMatchesRegistry(mirrorWorking, 'narduk-mirror')).toBe(true)
    expect(githubPackagesDependabot()).not.toContain(PLACEHOLDER)
    expect(githubPackagesDependabot()).toContain('https://npm.pkg.github.com')
  })

  it('requires an npm update block before calling a mirror file clean', () => {
    const actionsOnly = [
      'version: 2',
      'registries:',
      '  npm-nard-uk:',
      '    type: npm-registry',
      '    url: https://npm.nard.uk',
      'updates:',
      '  - package-ecosystem: github-actions',
      '    directory: /',
      '    cooldown:',
      '      default-days: 0',
      '',
    ].join('\n')
    expect(hasExplicitZeroCooldown(actionsOnly)).toBe(true)
    expect(hasNpmUpdateBlock(actionsOnly)).toBe(false)
    expect(hasNpmUpdateBlock(mirrorWorking)).toBe(true)
    expect(dependabotMatchesRegistry(actionsOnly, 'narduk-mirror')).toBe(false)
  })
})

describe('upgrade dependabot registry', () => {
  it('does not add a placeholder registry to a working GitHub Packages file', async () => {
    const targetDir = await checkout()
    await write(targetDir, '.npmrc', '@narduk-enterprises:registry=https://npm.pkg.github.com\n')
    await write(targetDir, '.github/dependabot.yml', githubWorking)
    await write(targetDir, 'package.json', '{ "name": "gonogo", "private": true }\n')

    const report = await upgradeNardukApp({
      only: ['.github/dependabot.yml'],
      targetDir,
      write: true,
    })
    const change = report.changes.find((entry) => entry.path === '.github/dependabot.yml')

    expect(change?.status).toBe('clean')
    expect(change?.diff).toBe('')
    expect(await readFile(join(targetDir, '.github/dependabot.yml'), 'utf8')).toBe(githubWorking)
    expect(githubWorking).not.toContain(PLACEHOLDER)
  })

  it('does not replace a working npm.nard.uk file with a GitHub Packages registry', async () => {
    const targetDir = await checkout()
    await write(targetDir, '.npmrc', '@narduk-enterprises:registry=https://npm.nard.uk\n')
    await write(targetDir, '.github/dependabot.yml', mirrorWorking)
    await write(targetDir, 'package.json', '{ "name": "riverstatus", "private": true }\n')

    const report = await upgradeNardukApp({
      only: ['.github/dependabot.yml'],
      targetDir,
      write: true,
    })
    expect(report.changes.find((entry) => entry.path === '.github/dependabot.yml')?.status).toBe(
      'clean',
    )
    const after = await readFile(join(targetDir, '.github/dependabot.yml'), 'utf8')
    expect(after).toBe(mirrorWorking)
  })

  it('rewrites a GitHub Packages app onto the GitHub registry, never the placeholder', async () => {
    const targetDir = await checkout()
    await write(targetDir, '.npmrc', '@narduk-enterprises:registry=https://npm.pkg.github.com\n')
    await write(
      targetDir,
      '.github/dependabot.yml',
      'version: 2\nupdates:\n  - package-ecosystem: npm\n    directory: /\n    cooldown:\n      default-days: 3\n',
    )
    await write(targetDir, 'package.json', '{ "name": "gonogo", "private": true }\n')

    const report = await upgradeNardukApp({
      only: ['.github/dependabot.yml'],
      targetDir,
      write: true,
    })
    const after = await readFile(join(targetDir, '.github/dependabot.yml'), 'utf8')
    expect(report.changes.find((entry) => entry.path === '.github/dependabot.yml')?.status).toBe(
      'drift',
    )
    expect(after).toContain('https://npm.pkg.github.com')
    expect(after).toContain('NARDUK_PLATFORM_GH_PACKAGES_READ')
    expect(after).not.toContain(PLACEHOLDER)
    expect(after).not.toContain('npm.nard.uk')
  })

  it('rewrites a mirror file that has no npm update block', async () => {
    const targetDir = await checkout()
    const actionsOnly = [
      'version: 2',
      'registries:',
      '  npm-nard-uk:',
      '    type: npm-registry',
      '    url: https://npm.nard.uk',
      'updates:',
      '  - package-ecosystem: github-actions',
      '    directory: /',
      '    cooldown:',
      '      default-days: 0',
      '',
    ].join('\n')
    await write(targetDir, '.npmrc', '@narduk-enterprises:registry=https://npm.nard.uk\n')
    await write(targetDir, '.github/dependabot.yml', actionsOnly)
    await write(targetDir, 'package.json', '{ "name": "riverstatus", "private": true }\n')

    const report = await upgradeNardukApp({
      only: ['.github/dependabot.yml'],
      targetDir,
      write: true,
    })
    const after = await readFile(join(targetDir, '.github/dependabot.yml'), 'utf8')
    expect(report.changes.find((entry) => entry.path === '.github/dependabot.yml')?.status).toBe(
      'drift',
    )
    expect(after).toContain("package-ecosystem: 'npm'")
    expect(after).not.toBe(actionsOnly)
  })

  it('does not create a placeholder-token file when the registry is unknown', async () => {
    const targetDir = await checkout()
    await write(targetDir, 'package.json', '{ "name": "unknown-app", "private": true }\n')

    const report = await upgradeNardukApp({
      only: ['.github/dependabot.yml'],
      targetDir,
      write: true,
    })
    const change = report.changes.find((entry) => entry.path === '.github/dependabot.yml')
    expect(change?.status).toBe('unresolved')
    expect(change?.diff).toBe('')
    expect(change?.applied).toBe(false)
    await expect(readFile(join(targetDir, '.github/dependabot.yml'), 'utf8')).rejects.toThrow()
  })

  it('reports an existing file as unresolved, not clean, when the registry is unknown', async () => {
    const targetDir = await checkout()
    await write(targetDir, 'package.json', '{ "name": "unknown-app", "private": true }\n')
    const existing =
      'version: 2\nupdates:\n  - package-ecosystem: github-actions\n    directory: /\n'
    await write(targetDir, '.github/dependabot.yml', existing)

    const report = await upgradeNardukApp({
      only: ['.github/dependabot.yml'],
      targetDir,
      write: true,
    })
    const change = report.changes.find((entry) => entry.path === '.github/dependabot.yml')
    expect(change?.status).toBe('unresolved')
    expect(change?.applied).toBe(false)
    await expect(readFile(join(targetDir, '.github/dependabot.yml'), 'utf8')).resolves.toBe(
      existing,
    )
  })

  it('still matches a freshly generated npm.nard.uk app', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'create-narduk-dependabot-scaffold-'))
    tempDirectories.push(directory)
    const targetDir = join(directory, 'app')
    await createNardukApp({
      appName: 'mirror-fixture',
      capabilities: 'seo',
      noGit: true,
      targetDir,
    })
    const report = await upgradeNardukApp({ only: ['.github/dependabot.yml'], targetDir })
    expect(report.changes[0]?.status).toBe('clean')
    expect(report.changes[0]?.diff).toBe('')
  })
})
