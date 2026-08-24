import { describe, expect, it } from 'vitest'

import { defineCatalog } from '../src/define.js'
import { appleJourney, catalog, webJourney } from './helpers.js'

describe('defineCatalog', () => {
  it('accepts a valid catalog', () => {
    expect(() => defineCatalog(catalog())).not.toThrow()
  })

  it('collects every problem instead of stopping at the first', () => {
    const bad = catalog({
      journeys: [webJourney({ id: 'Bad Id', scenarios: ['missing'], role: 'nobody' })],
    })
    expect(() => defineCatalog(bad)).toThrow(/kebab-case[\s\S]*unknown scenario[\s\S]*unknown role/)
  })

  it('rejects skipWhen on a single-scenario journey as dead weight', () => {
    const bad = catalog({
      journeys: [
        webJourney({
          steps: [
            { id: 'only', say: 'Only step', skipWhen: { scenarios: ['base'] }, do: async () => {} },
          ],
        }),
      ],
    })
    expect(() => defineCatalog(bad)).toThrow(/dead weight/)
  })

  it('rejects a skipWhen that skips every declared scenario', () => {
    const bad = catalog({
      journeys: [
        webJourney({
          scenarios: ['base', 'extra'],
          steps: [
            {
              id: 'never',
              say: 'Never runs',
              skipWhen: { scenarios: ['base', 'extra'] },
              do: async () => {},
            },
          ],
        }),
      ],
    })
    expect(() => defineCatalog(bad)).toThrow(/never runs/)
  })

  it('rejects a secret-class role on an Apple surface while 13.8 is open', () => {
    const bad = catalog({
      audience: {
        visitor: { credentialClass: 'public-synthetic' },
        boss: { credentialClass: 'secret', secretRef: 'FIXTURE_BOSS', web: async () => {} },
      },
      journeys: [appleJourney({ role: 'boss' })],
    })
    expect(() => defineCatalog(bad)).toThrow(/secret-class role .* Apple surface/)
  })

  it('rejects an empty Apple binding field', () => {
    const bad = catalog({
      journeys: [
        appleJourney({
          binding: { xcTarget: 'FixtureUITests', xcClass: '', xcMethod: 'testX' },
        }),
      ],
    })
    expect(() => defineCatalog(bad)).toThrow(/binding.xcClass is empty/)
  })

  it('rejects a sequence whose member disagrees on surface or scenario', () => {
    const bad = catalog({
      journeys: [webJourney(), appleJourney()],
      sequences: [
        {
          id: 'walk',
          scenario: 'extra',
          surface: 'web',
          journeys: ['happy-path', 'scan-to-ticket'],
        },
      ],
    })
    expect(() => defineCatalog(bad)).toThrow(/does not declare scenario "extra"[\s\S]*is ios/)
  })
})
