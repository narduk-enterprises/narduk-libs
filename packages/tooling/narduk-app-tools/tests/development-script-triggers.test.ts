import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  mergeArtifactScriptTriggers,
  parseDeclaredScriptTriggers,
  readDeclaredScriptTriggers,
  routePattern,
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
    expect(readDeclaredScriptTriggers(root).triggers).toEqual({
      crons: ['20 9 * * *'],
      routes: ['app.example.com/*'],
    })
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
})
