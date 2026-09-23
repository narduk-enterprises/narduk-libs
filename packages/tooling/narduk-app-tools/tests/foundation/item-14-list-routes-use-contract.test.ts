import { rmSync } from 'node:fs'

import { afterEach, describe, expect, it } from 'vitest'

import { runListRoutesCheck } from '../../src/foundation/evaluate-component-suite.js'
import { isListRoute } from '../../src/foundation/items/item-14-list-routes-use-contract.js'
import { makeTempRepo, writeFile, writeJson } from './helpers.js'

const tempDirs: string[] = []
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { force: true, recursive: true })
})

function app(files: Record<string, string>): string {
  const root = makeTempRepo()
  tempDirs.push(root)
  writeJson(root, 'package.json', { name: 'fixture' })
  for (const [rel, text] of Object.entries(files)) writeFile(root, rel, text)
  return root
}

const HAND_ROLLED = `export default defineEventHandler((event) => {
  const query = getQuery(event)
  const limit = Math.min(Number(query.limit ?? 50), 100)
  return db.select().from(items).limit(limit)
})
`

const CONTRACT = `export default defineEventHandler(async (event) => {
  const query = parseListQuery(event, { sortable: ['name'], maxLimit: 100, mode: 'offset' })
  const rows = await db.select().from(items).limit(query.limit).offset(query.offset)
  return listResponse(rows, { total: null, query })
})
`

const DETAIL = `export default defineEventHandler(async (event) => {
  const { id } = getQuery(event)
  return db.select().from(items).where(eq(items.id, String(id))).limit(1)
})
`

describe('item 14 list-routes-use-contract', () => {
  it('fails a GET route that parses its own pagination', () => {
    const root = app({ 'server/api/items/index.get.ts': HAND_ROLLED })

    const artefact = runListRoutesCheck({ root, toolVersion: 'test' })
    expect(artefact.item).toMatchObject({
      id: 14,
      name: 'list-routes-use-contract',
      status: 'fail',
    })
    expect(artefact.item.checks[0]?.detail).toContain('server/api/items/index.get.ts')
    expect(artefact.exitCode).toBe(1)
  })

  it('passes a list route that calls parseListQuery', () => {
    const root = app({ 'apps/web/server/api/items/index.get.ts': CONTRACT })

    const artefact = runListRoutesCheck({ root, toolVersion: 'test' })
    expect(artefact.result).toBe('PASS')
    expect(artefact.item.checks[0]?.detail).toContain('all 1 list route(s)')
  })

  it("does not take the Drizzle builder's .limit(1) for pagination", () => {
    const root = app({ 'server/api/items/detail.get.ts': DETAIL })

    const artefact = runListRoutesCheck({ root, toolVersion: 'test' })
    expect(artefact.result).toBe('PASS')
    expect(artefact.item.checks[0]?.detail).toContain('no list routes among 1 handler(s)')
  })

  it('ignores mutation routes', () => {
    expect(isListRoute('server/api/items/index.post.ts', HAND_ROLLED)).toBe(false)
    expect(isListRoute('server/api/items.ts', HAND_ROLLED)).toBe(true)
    expect(isListRoute('server/routes/feed.get.ts', "getQuery(event)['cursor']")).toBe(true)
  })

  it('is N/A for an app with no server routes', () => {
    const root = app({ 'app/pages/index.vue': '<template><div /></template>\n' })

    const artefact = runListRoutesCheck({ root, toolVersion: 'test' })
    expect(artefact.item.status).toBe('not-applicable')
    expect(artefact.exitCode).toBe(0)
  })
})
