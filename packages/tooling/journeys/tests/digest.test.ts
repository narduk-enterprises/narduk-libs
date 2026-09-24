import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { digestDirectory, digestFiles, digestJourney } from '../src/digest.js'
import { drivenJourney, webJourney } from './helpers.js'

describe('digestFiles', () => {
  it('is stable across insertion order', () => {
    const first = digestFiles(
      new Map([
        ['a.ts', 'one'],
        ['b.ts', 'two'],
      ]),
    )
    const second = digestFiles(
      new Map([
        ['b.ts', 'two'],
        ['a.ts', 'one'],
      ]),
    )
    expect(first).toBe(second)
  })

  it('changes when content or path changes', () => {
    const base = digestFiles(new Map([['a.ts', 'one']]))
    expect(digestFiles(new Map([['a.ts', 'two']]))).not.toBe(base)
    expect(digestFiles(new Map([['b.ts', 'one']]))).not.toBe(base)
  })
})

describe('digestDirectory', () => {
  const dirs: string[] = []
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { force: true, recursive: true })
  })

  it('moves when a file of a megabyte or more changes (#118)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'journeys-digest-'))
    dirs.push(dir)
    writeFileSync(join(dir, 'catalog.ts'), 'export const steps = []')
    writeFileSync(join(dir, 'seed.json'), Buffer.alloc(1_200_000, 'a'))
    const before = digestDirectory(dir)

    writeFileSync(join(dir, 'seed.json'), Buffer.alloc(1_200_000, 'b'))
    expect(digestDirectory(dir)).not.toBe(before)
  })
})

describe('digestJourney', () => {
  const dirs: string[] = []
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { force: true, recursive: true })
  })

  it('does not move when a sibling journey is added to the catalog (#66)', () => {
    const first = webJourney({ id: 'one-load-gate-to-gate' })
    const before = digestJourney(first)
    const sibling = webJourney({ id: 'the-money-day' })
    expect(digestJourney(first)).toBe(before)
    expect(digestJourney(sibling)).not.toBe(before)
  })

  it('does not move when a sibling file is added under the catalog directory (#66)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'journeys-digest-'))
    dirs.push(dir)
    writeFileSync(join(dir, 'one.ts'), 'export const one = 1\n')
    const first = webJourney({ id: 'one-load-gate-to-gate' })
    const beforeJourney = digestJourney(first)
    const beforeDirectory = digestDirectory(dir)

    writeFileSync(join(dir, 'two.ts'), 'export const two = 2\n')
    expect(digestDirectory(dir)).not.toBe(beforeDirectory)
    expect(digestJourney(first)).toBe(beforeJourney)
  })

  it('is stable across Playwright and Node function pretty-printing', () => {
    const nodeSource =
      "async do(c) {\n            await c.goto('/start')\n            await c.must('Begin')\n          }"
    const playwrightSource =
      "async do(c) {\n        await c.goto('/start');\n        await c.must('Begin');\n        await c.page.getByText('x').waitFor({\n          timeout: 5000\n        });\n      }"
    const sameBody =
      "async do(c) {\n            await c.goto('/start')\n            await c.must('Begin')\n            await c.page.getByText('x').waitFor({ timeout: 5000 })\n          }"
    const withSource = (source: string) => {
      const run = async () => {}
      run.toString = () => source
      return webJourney({
        id: 'walk',
        steps: [{ id: 'open-start', say: 'Open the start page', do: run }],
      })
    }
    expect(digestJourney(withSource(playwrightSource))).toBe(digestJourney(withSource(sameBody)))
    expect(digestJourney(withSource(nodeSource))).not.toBe(digestJourney(withSource(sameBody)))
  })

  it("moves when this journey's prose or step body changes", () => {
    const base = digestJourney(webJourney({ id: 'walk' }))
    expect(digestJourney(webJourney({ id: 'walk', title: 'Changed title' }))).not.toBe(base)
    expect(
      digestJourney(
        webJourney({
          id: 'walk',
          steps: [
            {
              id: 'open-start',
              say: 'Open the start page',
              do: async () => {
                await Promise.resolve('body-changed')
              },
            },
            { id: 'finish', say: 'Press Finish', do: async () => {} },
          ],
        }),
      ),
    ).not.toBe(base)
    expect(digestJourney(drivenJourney({ id: 'walk' }))).not.toBe(base)
  })
})
