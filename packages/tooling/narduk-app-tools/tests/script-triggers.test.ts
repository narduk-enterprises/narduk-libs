import { describe, expect, it } from 'vitest'

import { mergeArtifactScriptTriggers } from '../src/script-triggers.js'

describe('mergeArtifactScriptTriggers', () => {
  it('overlays artifact triggers onto the flattened deploy config', () => {
    expect(
      mergeArtifactScriptTriggers(
        { name: 'app', triggers: { crons: ['0 9 * * *'] }, vars: { A: '1' } },
        { triggers: { crons: ['20 9 * * *'] }, routes: ['app.example.com/*'] },
      ),
    ).toEqual({
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
    expect(merged).toEqual({ name: 'app', routes: ['new.example.com/*'] })
    expect(merged).not.toHaveProperty('route')
  })

  it('treats a missing triggers key as unspecified and an empty cron list as a wipe', () => {
    const base = { name: 'app', triggers: { crons: ['0 9 * * *'] } }
    expect(mergeArtifactScriptTriggers(base, { name: 'app' })).toEqual(base)
    expect(mergeArtifactScriptTriggers(base, { triggers: { crons: [] } })).toEqual({
      name: 'app',
      triggers: { crons: [] },
    })
  })

  it('refuses a malformed cron or route', () => {
    expect(() => mergeArtifactScriptTriggers({}, { triggers: { crons: [''] } })).toThrow(
      'triggers.crons[0]',
    )
    expect(() => mergeArtifactScriptTriggers({}, { routes: [42] })).toThrow('routes[0]')
  })
})
