/**
 * The fixture repository's declaration, written the way a consumer would
 * write one — importing only the core, no Playwright.
 */
import { defineCatalog } from '../../../dist/index.js'

export const catalog = defineCatalog({
  scenarios: [
    { id: 'base', name: 'The base world', blurb: 'Two rooms and a finish line.' },
    { id: 'extra', name: 'The extra world', blurb: 'The base world with the extra room open.' },
  ],
  profiles: {
    desktop: { kind: 'web', viewport: { width: 1280, height: 800 } },
  },
  audience: {
    visitor: { credentialClass: 'public-synthetic' },
  },
  journeys: [
    {
      id: 'happy-path',
      title: 'Walk to the finish',
      surface: 'web',
      role: 'visitor',
      scenarios: ['base'],
      outcome: 'A visitor reaches the end in two presses.',
      steps: [
        {
          id: 'open-start',
          say: 'Open the start page',
          async do(c) {
            await c.goto('/start')
          },
        },
        {
          id: 'begin',
          say: 'Press Begin and land on step two',
          async do(c) {
            await c.must('Begin')
            await c.page.getByText('The middle of the journey.').waitFor({ timeout: 5000 })
          },
        },
        {
          id: 'finish',
          say: 'Press Finish and read the confirmation',
          capture: { dwell: 200 },
          async do(c) {
            await c.must('Finish')
            await c.page.getByText('All done').waitFor({ timeout: 5000 })
          },
        },
      ],
    },
    {
      id: 'flagged-extra',
      title: 'Visit the extra room when the world has one',
      surface: 'web',
      role: 'visitor',
      scenarios: ['extra', 'base'],
      outcome: 'The extra room is visited exactly when the world declares it open.',
      steps: [
        {
          id: 'open-start',
          say: 'Open the start page',
          async do(c) {
            await c.goto('/start')
          },
        },
        {
          id: 'visit-extra',
          say: 'Visit the extra room',
          async appliesIf(world) {
            const facts = await world.get('/api/flag')
            return facts.showExtra
              ? { applicable: true }
              : { applicable: false, reason: 'world reports showExtra=false' }
          },
          async do(c) {
            await c.goto('/extra')
            await c.page.getByText('The extra room.').waitFor({ timeout: 5000 })
          },
        },
        {
          id: 'base-only-note',
          say: 'Read the start page again (base world only)',
          skipWhen: { scenarios: ['extra'] },
          async do(c) {
            await c.goto('/start')
          },
        },
      ],
    },
  ],
})

/** A journey that must go RED: its control does not exist. */
export const brokenCatalog = defineCatalog({
  scenarios: [{ id: 'base', name: 'The base world', blurb: 'Two rooms and a finish line.' }],
  profiles: { desktop: { kind: 'web', viewport: { width: 1280, height: 800 } } },
  audience: { visitor: { credentialClass: 'public-synthetic' } },
  journeys: [
    {
      id: 'broken-selector',
      title: 'Press a button that is not there',
      surface: 'web',
      role: 'visitor',
      scenarios: ['base'],
      outcome: 'This journey exists to prove a renamed control is a red run, not a skip.',
      steps: [
        {
          id: 'open-start',
          say: 'Open the start page',
          async do(c) {
            await c.goto('/start')
          },
        },
        {
          id: 'press-missing',
          say: 'Press the missing button',
          async do(c) {
            await c.must('Nonexistent')
          },
        },
      ],
    },
  ],
})
