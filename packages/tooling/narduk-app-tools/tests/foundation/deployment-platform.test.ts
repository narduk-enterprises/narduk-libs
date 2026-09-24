import { rmSync } from 'node:fs'

import { afterEach, describe, expect, it } from 'vitest'

import { AppRepo } from '../../src/foundation/source.js'
import {
  classifyDeploymentPlatform,
  readExposureClass,
} from '../../src/foundation/deployment-platform.js'
import { makeTempRepo, writeCoolifyOnlyApp, writeFile, writeJson } from './helpers.js'

const tempDirs: string[] = []
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { force: true, recursive: true })
})

describe('deployment platform', () => {
  it('reads exclusive coolify targets from project-lifecycle.json', () => {
    const root = makeTempRepo()
    tempDirs.push(root)
    writeCoolifyOnlyApp(root)
    expect(classifyDeploymentPlatform(new AppRepo(root))).toMatchObject({
      evidence: 'Config/project-lifecycle.json',
      kind: 'non-cloudflare',
      providers: ['coolify'],
    })
    expect(readExposureClass(new AppRepo(root))).toEqual({
      evidence: 'Config/coolify-app.json',
      value: 'public',
    })
  })

  it('treats coolify-app.json without a Cloudflare manifest as non-Cloudflare', () => {
    const root = makeTempRepo()
    tempDirs.push(root)
    writeJson(root, 'Config/coolify-app.json', { access: { exposureClass: 'private' } })
    expect(classifyDeploymentPlatform(new AppRepo(root))).toMatchObject({
      evidence: 'Config/coolify-app.json',
      kind: 'non-cloudflare',
      providers: ['coolify'],
    })
  })

  it('keeps mixed cloudflare+coolify targets on the Workers path', () => {
    const root = makeTempRepo()
    tempDirs.push(root)
    writeJson(root, 'Config/project-lifecycle.json', {
      environments: [
        {
          name: 'production',
          deploymentTargets: [{ provider: 'coolify' }, { provider: 'cloudflare' }],
        },
      ],
    })
    expect(classifyDeploymentPlatform(new AppRepo(root)).kind).toBe('mixed')
  })

  it('is undeclared when lifecycle has no providers', () => {
    const root = makeTempRepo()
    tempDirs.push(root)
    writeFile(root, 'README.md', 'fixture')
    expect(classifyDeploymentPlatform(new AppRepo(root)).kind).toBe('undeclared')
  })
})
