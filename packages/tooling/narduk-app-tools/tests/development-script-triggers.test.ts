import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  mergeArtifactScriptTriggers,
  parseDeclaredScriptTriggers,
  readDeclaredScriptTriggers,
  routePattern,
  scriptTriggerMismatch,
} from '../src/development-script-triggers.js'

describe('declared Worker script triggers', () => {
  it('treats a missing triggers key as unspecified, not empty', () => {
    expect(parseDeclaredScriptTriggers({ name: 'app' })).toEqual({})
    expect(parseDeclaredScriptTriggers({ triggers: {} }).crons).toBeUndefined()
  })

  it('reads crons and routes from wrangler.json shape', () => {
    const declared = parseDeclaredScriptTriggers({
      triggers: { crons: ['20 9 * * *'] },
      routes: [{ pattern: 'app.example.com/*', zone_name: 'example.com' }],
    })
    expect(declared.crons).toEqual(['20 9 * * *'])
    expect(declared.routes?.map(routePattern)).toEqual(['app.example.com/*'])
  })

  it('treats an empty crons array as an explicit wipe', () => {
    expect(parseDeclaredScriptTriggers({ triggers: { crons: [] } })).toEqual({ crons: [] })
  })

  it('prefers artifact-declared crons over the source config', () => {
    const root = mkdtempSync(join(tmpdir(), 'script-triggers-'))
    writeFileSync(
      join(root, 'wrangler.jsonc'),
      JSON.stringify({ name: 'app', triggers: { crons: ['0 9 * * *', '20 9 * * *'] } }),
    )
    mkdirSync(join(root, '.output', 'server'), { recursive: true })
    writeFileSync(
      join(root, '.output', 'server', 'wrangler.json'),
      JSON.stringify({ name: 'app', triggers: { crons: ['20 9 * * *'] } }),
    )
    const resolved = readDeclaredScriptTriggers(root)
    expect(resolved.triggers.crons).toEqual(['20 9 * * *'])
    expect(resolved.source).toContain('.output/server/wrangler.json')
  })

  it('falls back to source crons when the artifact omits them', () => {
    const root = mkdtempSync(join(tmpdir(), 'script-triggers-'))
    writeFileSync(
      join(root, 'wrangler.jsonc'),
      JSON.stringify({
        name: 'app',
        triggers: { crons: ['20 9 * * *'] },
        routes: ['app.example.com/*'],
      }),
    )
    mkdirSync(join(root, '.output', 'server'), { recursive: true })
    writeFileSync(
      join(root, '.output', 'server', 'wrangler.json'),
      JSON.stringify({ name: 'app', main: './index.mjs' }),
    )
    const resolved = readDeclaredScriptTriggers(root)
    expect(resolved.triggers).toEqual({
      crons: ['20 9 * * *'],
      routes: ['app.example.com/*'],
    })
    expect(resolved.source).toBe(join(root, 'wrangler.jsonc'))
  })

  it('overlays artifact triggers onto the flattened deploy config', () => {
    const merged = mergeArtifactScriptTriggers(
      { name: 'app', triggers: { crons: ['0 9 * * *'] }, vars: { A: '1' } },
      { triggers: { crons: ['20 9 * * *'] }, routes: ['app.example.com/*'] },
    )
    expect(merged).toEqual({
      name: 'app',
      vars: { A: '1' },
      triggers: { crons: ['20 9 * * *'] },
      routes: ['app.example.com/*'],
    })
  })

  it('drops singular route when the artifact supplies routes', () => {
    const merged = mergeArtifactScriptTriggers(
      { name: 'app', route: 'old.example.com/*' },
      { route: 'new.example.com/*' },
    )
    expect(merged).toEqual({
      name: 'app',
      routes: ['new.example.com/*'],
    })
    expect(merged).not.toHaveProperty('route')
  })
})

describe('script trigger mismatch', () => {
  const live = { crons: ['0 9 * * *', '20 9 * * *'], routes: ['app.example.com'] }

  it('does not call an unmanaged key a mismatch', () => {
    expect(scriptTriggerMismatch({}, live)).toEqual([])
  })

  it('names both directions, with custom domains compared by hostname', () => {
    expect(
      scriptTriggerMismatch(
        {
          crons: ['20 9 * * *', '*/5 * * * *'],
          routes: [{ pattern: 'app.example.com', custom_domain: true }],
        },
        live,
      ),
    ).toEqual([{ kind: 'crons', declaredOnly: ['*/5 * * * *'], liveOnly: ['0 9 * * *'] }])
  })

  it('treats an empty declared list as removing every live trigger', () => {
    expect(scriptTriggerMismatch({ crons: [], routes: [] }, live)).toEqual([
      { kind: 'crons', declaredOnly: [], liveOnly: ['0 9 * * *', '20 9 * * *'] },
      { kind: 'routes', declaredOnly: [], liveOnly: ['app.example.com'] },
    ])
  })
})
