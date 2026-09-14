import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { NardukRealtimeConfigurationError, resolveDurableObjects } from '../src/options.js'

let rootDir = ''

beforeEach(async () => {
  rootDir = await mkdtemp(join(tmpdir(), 'narduk-realtime-root-'))
  await mkdir(join(rootDir, 'server/durable'), { recursive: true })
  await writeFile(join(rootDir, 'server/durable/vessel-do.ts'), 'export class VesselDO {}\n')
  await writeFile(join(rootDir, 'server/durable/fleet-do.mjs'), 'export class FleetDO {}\n')
  await mkdir(join(rootDir, 'server/durable/tenant'), { recursive: true })
  await writeFile(join(rootDir, 'server/durable/tenant/index.ts'), 'export class TenantDO {}\n')
})

afterEach(async () => {
  await rm(rootDir, { force: true, recursive: true })
})

describe('resolveDurableObjects', () => {
  it('resolves an extensionless relative path against the app rootDir', () => {
    expect(resolveDurableObjects({ VesselDO: './server/durable/vessel-do' }, rootDir)).toEqual([
      { className: 'VesselDO', modulePath: join(rootDir, 'server/durable/vessel-do.ts') },
    ])
  })

  it('resolves .mjs modules and directory entry points', () => {
    expect(
      resolveDurableObjects(
        { FleetDO: './server/durable/fleet-do', TenantDO: './server/durable/tenant' },
        rootDir,
      ),
    ).toEqual([
      { className: 'FleetDO', modulePath: join(rootDir, 'server/durable/fleet-do.mjs') },
      { className: 'TenantDO', modulePath: join(rootDir, 'server/durable/tenant/index.ts') },
    ])
  })

  it('sorts by class name so the generated entry is byte-identical across builds', () => {
    const forward = resolveDurableObjects(
      { VesselDO: './server/durable/vessel-do', FleetDO: './server/durable/fleet-do' },
      rootDir,
    )
    const reverse = resolveDurableObjects(
      { FleetDO: './server/durable/fleet-do', VesselDO: './server/durable/vessel-do' },
      rootDir,
    )

    expect(forward.map(({ className }) => className)).toEqual(['FleetDO', 'VesselDO'])
    expect(forward).toEqual(reverse)
  })

  // A package that ships its own Durable Object cannot be probed from inside a
  // pnpm store, so a bare specifier is handed to the bundler untouched.
  it('passes a bare package specifier through unchanged', () => {
    expect(
      resolveDurableObjects({ SharedDO: '@narduk-enterprises/example/durable' }, rootDir),
    ).toEqual([{ className: 'SharedDO', modulePath: '@narduk-enterprises/example/durable' }])
  })

  it('rejects a class name that is not a JavaScript identifier', () => {
    expect(() =>
      resolveDurableObjects({ 'vessel-do': './server/durable/vessel-do' }, rootDir),
    ).toThrow(NardukRealtimeConfigurationError)
    expect(() =>
      resolveDurableObjects({ 'vessel-do': './server/durable/vessel-do' }, rootDir),
    ).toThrow(/not a valid JavaScript identifier/u)
  })

  it('rejects an empty module path', () => {
    expect(() => resolveDurableObjects({ VesselDO: '   ' }, rootDir)).toThrow(
      /needs a module path/u,
    )
  })

  it('names every path it tried when a relative module does not resolve', () => {
    expect(() => resolveDurableObjects({ VesselDO: './server/durable/missing' }, rootDir)).toThrow(
      /does not resolve to a file\. Tried: .*missing, .*missing\.ts/u,
    )
  })

  it('returns nothing for an empty configuration', () => {
    expect(resolveDurableObjects({}, rootDir)).toEqual([])
  })
})
