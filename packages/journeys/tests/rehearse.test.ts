import { describe, expect, it } from 'vitest'

import { REHEARSAL_WATERMARK, buildRehearsal } from '../src/rehearse.js'
import { catalog, webJourney } from './helpers.js'

describe('buildRehearsal', () => {
  it('is watermarked, prose-only, and resolves static skips for the default scenario', () => {
    const rehearsal = buildRehearsal(
      catalog({
        journeys: [
          webJourney({
            scenarios: ['extra', 'base'],
            steps: [
              { id: 'a', say: 'Open the start page', do: async () => {} },
              {
                id: 'b',
                say: 'Base-only beat',
                skipWhen: { scenarios: ['extra'] },
                do: async () => {},
              },
            ],
          }),
        ],
      }),
    )
    expect(rehearsal).toContain(REHEARSAL_WATERMARK)
    expect(rehearsal).toContain('1. Open the start page')
    expect(rehearsal).not.toContain('Base-only beat')
    expect(rehearsal).toContain('**Afterwards:**')
  })
})
