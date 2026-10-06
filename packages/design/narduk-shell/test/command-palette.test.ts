/*
 * The command palette's engine, with no DOM and no Vue: the ranking, the
 * grouping into sections, the keyboard walk, recent items, the shared search
 * and the async runner.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  buildSections,
  createSearchRunner,
  createSharedSearch,
  flattenRows,
  highlightParts,
  matchItems,
  moveActive,
  normalizeQuery,
  pageActive,
  rememberRecent,
  resultSummary,
  sanitizeRecents,
  scoreItem,
  toRecent,
} from '../src/runtime/utils/command-palette'

import type {
  NeCommandGroup,
  NeCommandGroupState,
  NeCommandItem,
} from '../src/runtime/components/ne-command-palette-types'

const item = (id: string, label: string, extra: Partial<NeCommandItem> = {}): NeCommandItem => ({
  id,
  label,
  ...extra,
})

describe('normalizeQuery', () => {
  it('lowercases, folds accents and collapses space', () => {
    expect(normalizeQuery('  Rio   Grande ')).toBe('rio grande')
    expect(normalizeQuery('Pérez Río')).toBe('perez rio')
  })
})

describe('scoreItem', () => {
  it('finds nothing for a word that is nowhere in the row', () => {
    expect(scoreItem(item('a', 'Missouri River'), 'zzz')).toBe(0)
  })

  it('needs every word of the query to be found', () => {
    expect(scoreItem(item('a', 'Mississippi River'), 'miss river')).toBeGreaterThan(0)
    expect(scoreItem(item('b', 'Missoula Creek'), 'miss river')).toBe(0)
  })

  it('ranks the start of the title over a word start, over the middle', () => {
    const start = scoreItem(item('a', 'Mississippi River'), 'miss')
    const word = scoreItem(item('b', 'Little Mississippi'), 'miss')
    const middle = scoreItem(item('c', 'Commissioner Creek'), 'miss')
    expect(start).toBeGreaterThan(word)
    expect(word).toBeGreaterThan(middle)
    expect(middle).toBeGreaterThan(0)
  })

  it('ranks an exact title above a longer title it starts', () => {
    expect(scoreItem(item('a', 'Texas'), 'texas')).toBeGreaterThan(
      scoreItem(item('b', 'Texas City'), 'texas'),
    )
  })

  it('ranks the title over a keyword over the description', () => {
    const title = scoreItem(item('a', 'Missouri'), 'missouri')
    const keyword = scoreItem(item('b', 'Show-Me', { keywords: ['Missouri state'] }), 'missouri')
    const description = scoreItem(
      item('c', 'Hermann', { description: 'Missouri River' }),
      'missouri',
    )
    expect(title).toBeGreaterThan(keyword)
    expect(keyword).toBeGreaterThan(description)
    expect(description).toBeGreaterThan(0)
  })

  it('lets an exact keyword (a state code) beat a longer title that starts with it', () => {
    const missouri = item('MO', 'Missouri', { keywords: ['MO'] })
    const montana = item('MT', 'Montana', { keywords: ['MT'] })
    expect(scoreItem(missouri, 'mo')).toBeGreaterThan(scoreItem(montana, 'mo'))
  })

  it('ignores case and accents', () => {
    expect(scoreItem(item('a', 'Río Grande'), 'RIO')).toBeGreaterThan(0)
  })

  it('treats an empty query as matching everything', () => {
    expect(scoreItem(item('a', 'x'), '   ')).toBeGreaterThan(0)
  })
})

describe('matchItems', () => {
  const rivers = [
    item('1', 'Commissioner Creek'),
    item('2', 'Mississippi River'),
    item('3', 'Missouri River'),
    item('4', 'Little Miss Creek'),
  ]

  it('orders best first and keeps given order among ties', () => {
    const ids = matchItems(rivers, 'miss').map((row) => row.id)
    expect(ids).toEqual(['2', '3', '4', '1'])
  })

  it('cuts to the limit after ranking', () => {
    expect(matchItems(rivers, 'miss', { limit: 2 }).map((row) => row.id)).toEqual(['2', '3'])
  })

  it('keeps the provider order with rank source, and still drops non-matches', () => {
    const ids = matchItems(rivers, 'creek', { rank: 'source' }).map((row) => row.id)
    expect(ids).toEqual(['1', '4'])
  })

  it('keeps everything, in order, for an empty query', () => {
    expect(matchItems(rivers, '').map((row) => row.id)).toEqual(['1', '2', '3', '4'])
  })
})

describe('highlightParts', () => {
  it('marks each query word, ignoring case and accents', () => {
    expect(highlightParts('Mississippi River', 'miss riv')).toEqual([
      { text: 'Miss', hit: true },
      { text: 'issippi ', hit: false },
      { text: 'Riv', hit: true },
      { text: 'er', hit: false },
    ])
    expect(highlightParts('Río', 'rio')).toEqual([{ text: 'Río', hit: true }])
  })

  it('returns the text whole when there is nothing to mark', () => {
    expect(highlightParts('Missouri', '')).toEqual([{ text: 'Missouri', hit: false }])
    expect(highlightParts('Missouri', 'zzz')).toEqual([{ text: 'Missouri', hit: false }])
  })
})

describe('moveActive and pageActive', () => {
  it('starts at the first row going down and the last going up, and wraps', () => {
    expect(moveActive(-1, 1, 4)).toBe(0)
    expect(moveActive(-1, -1, 4)).toBe(3)
    expect(moveActive(3, 1, 4)).toBe(0)
    expect(moveActive(0, -1, 4)).toBe(3)
    expect(moveActive(0, 1, 0)).toBe(-1)
  })

  it('pages without wrapping', () => {
    expect(pageActive(0, 5, 12)).toBe(5)
    expect(pageActive(9, 5, 12)).toBe(11)
    expect(pageActive(2, -5, 12)).toBe(0)
    expect(pageActive(-1, 5, 12)).toBe(4)
  })
})

describe('recents', () => {
  it('stores plain fields only, dropping a stale badge', () => {
    const recent = toRecent('rivers', {
      ...item('a', 'Missouri River', { description: 'MO', icon: 'i-x', to: '/rivers/a' }),
      badge: { label: 'Flooding' },
    })
    expect(recent).toEqual({
      groupId: 'rivers',
      item: { description: 'MO', icon: 'i-x', id: 'a', label: 'Missouri River', to: '/rivers/a' },
    })
  })

  it('puts the newest first, drops its earlier copy and keeps at most max', () => {
    const a = toRecent('g', item('a', 'A'))
    const b = toRecent('g', item('b', 'B'))
    const c = toRecent('g', item('c', 'C'))
    let list = rememberRecent([], a, 2)
    list = rememberRecent(list, b, 2)
    list = rememberRecent(list, a, 2)
    expect(list.map((entry) => entry.item.id)).toEqual(['a', 'b'])
    list = rememberRecent(list, c, 2)
    expect(list.map((entry) => entry.item.id)).toEqual(['c', 'a'])
    expect(rememberRecent(list, a, 0)).toEqual([])
  })

  it('keeps the same id in two groups apart', () => {
    const list = rememberRecent(
      [toRecent('rivers', item('1', 'X'))],
      toRecent('gauges', item('1', 'X')),
      6,
    )
    expect(list).toHaveLength(2)
  })

  it('drops malformed storage and keeps the good entries', () => {
    const raw = [
      {
        groupId: 'g',
        item: { id: 'a', label: 'A', to: '/a', actions: [{ id: 'm', label: 'Map', to: '/m' }] },
      },
      { groupId: 'g', item: { id: 'b' } },
      { groupId: '', item: { id: 'c', label: 'C' } },
      'nope',
      null,
    ]
    const clean = sanitizeRecents(raw, 6)
    expect(clean).toHaveLength(1)
    expect(clean[0]?.item.actions).toEqual([{ id: 'm', label: 'Map', to: '/m' }])
    expect(sanitizeRecents('not an array', 6)).toEqual([])
    expect(sanitizeRecents(raw, 0)).toEqual([])
  })
})

describe('buildSections', () => {
  const pages: NeCommandGroup = {
    id: 'pages',
    idleLimit: 3,
    items: [
      item('map', 'Map'),
      item('rivers', 'Rivers'),
      item('states', 'States'),
      item('about', 'About'),
    ],
    label: 'Pages',
  }
  const states: NeCommandGroup = {
    id: 'states',
    items: [
      item('MO', 'Missouri', { keywords: ['MO'] }),
      item('MS', 'Mississippi', { keywords: ['MS'] }),
      item('TX', 'Texas', { keywords: ['TX'] }),
    ],
    label: 'States',
  }
  const rivers: NeCommandGroup = { id: 'rivers', label: 'Rivers', search: async () => [] }

  const base = { providers: {}, recentLabel: 'Recent', recents: [] }

  it('before a query, shows recents then the groups that offer rows, each cut to idleLimit', () => {
    const recents = [toRecent('states', item('TX', 'Texas'))]
    const sections = buildSections({
      ...base,
      groups: [pages, states, rivers],
      query: '',
      recents,
    })
    expect(sections.map((section) => section.id)).toEqual(['__recent', 'pages'])
    expect(sections[1]?.rows.map((row) => row.item.id)).toEqual(['map', 'rivers', 'states'])
    expect(sections[0]?.rows[0]?.groupId).toBe('states')
  })

  it('numbers rows in one flat sequence across sections', () => {
    const sections = buildSections({ ...base, groups: [pages, states], query: 'mis' })
    const flat = flattenRows(sections)
    expect(flat.map((row) => row.index)).toEqual(flat.map((_, i) => i))
    expect(new Set(flat.map((row) => row.key)).size).toBe(flat.length)
  })

  it('ranks a static group and leaves out groups with no match', () => {
    const sections = buildSections({ ...base, groups: [pages, states], query: 'miss' })
    expect(sections.map((section) => section.id)).toEqual(['states'])
    // Both start with "miss", so the group's own order decides between them.
    expect(sections[0]?.rows.map((row) => row.item.label)).toEqual(['Missouri', 'Mississippi'])
  })

  it('puts the provider answer under its group, in the provider order', () => {
    const providers: Record<string, NeCommandGroupState> = {
      rivers: {
        items: [item('b', 'Beta Creek'), item('a', 'Alpha Creek')],
        status: 'ready',
      },
    }
    const sections = buildSections({ ...base, groups: [states, rivers], providers, query: 'creek' })
    expect(sections.map((section) => section.id)).toEqual(['rivers'])
    expect(sections[0]?.rows.map((row) => row.item.id)).toEqual(['b', 'a'])
  })

  it('re-ranks a provider answer when its group asks for rank match', () => {
    const group: NeCommandGroup = { ...rivers, rank: 'match' }
    const providers: Record<string, NeCommandGroupState> = {
      rivers: { items: [item('b', 'Little Creek'), item('a', 'Creek Road')], status: 'ready' },
    }
    const sections = buildSections({ ...base, groups: [group], providers, query: 'creek' })
    expect(sections[0]?.rows.map((row) => row.item.id)).toEqual(['a', 'b'])
  })

  it('cuts each group to its limit, 5 by default', () => {
    const many: NeCommandGroup = {
      id: 'many',
      items: Array.from({ length: 9 }, (_, i) => item(`n${i}`, `Name ${i}`)),
      label: 'Many',
    }
    const sections = buildSections({ ...base, groups: [many], query: 'name' })
    expect(sections[0]?.rows).toHaveLength(5)
    const limited = buildSections({ ...base, groups: [{ ...many, limit: 2 }], query: 'name' })
    expect(limited[0]?.rows).toHaveLength(2)
  })

  it('keeps a loading group with rows loading, and shows a failed one as an error', () => {
    const providers: Record<string, NeCommandGroupState> = {
      rivers: { items: [item('a', 'Old Creek')], status: 'loading' },
    }
    const loading = buildSections({ ...base, groups: [rivers], providers, query: 'creek' })
    expect(loading[0]?.status).toBe('loading')
    expect(loading[0]?.rows).toHaveLength(1)

    const failed = buildSections({
      ...base,
      groups: [rivers],
      providers: { rivers: { items: [], status: 'error' } },
      query: 'creek',
    })
    expect(failed).toHaveLength(1)
    expect(failed[0]?.status).toBe('error')
    expect(failed[0]?.rows).toEqual([])
  })

  it('takes a function of the query as a group (a "see all results" row)', () => {
    const all: NeCommandGroup = {
      id: 'all',
      items: (query) => [item('all', `Search for “${query}”`, { keywords: [query] })],
      label: 'Search',
      rank: 'source',
    }
    const sections = buildSections({ ...base, groups: [all], query: 'xyz' })
    expect(sections[0]?.rows[0]?.item.label).toBe('Search for “xyz”')
  })

  it('lists a row once even when two sources hand it over', () => {
    const group: NeCommandGroup = {
      id: 'g',
      items: [item('a', 'Alpha')],
      label: 'G',
      search: async () => [],
    }
    const providers: Record<string, NeCommandGroupState> = {
      g: { items: [item('a', 'Alpha'), item('b', 'Alpha Two')], status: 'ready' },
    }
    const sections = buildSections({ ...base, groups: [group], providers, query: 'alpha' })
    expect(sections[0]?.rows.map((row) => row.item.id)).toEqual(['a', 'b'])
  })
})

describe('resultSummary', () => {
  it('says nothing before a query, "No results" for none, and counts by group otherwise', () => {
    expect(resultSummary([], '')).toBe('')
    expect(resultSummary([], 'miss')).toBe('No results')
    const sections = buildSections({
      groups: [{ id: 's', items: [item('a', 'Alpha'), item('b', 'Alpine')], label: 'States' }],
      providers: {},
      query: 'al',
      recentLabel: 'Recent',
      recents: [],
    })
    expect(resultSummary(sections, 'al')).toBe('2 results: 2 states')
  })

  it('names the sources a provider could not read, so "no results" is never claimed for them', () => {
    const answered = buildSections({
      groups: [{ id: 'r', label: 'Rivers', search: async () => [] }],
      providers: { r: { items: [], notes: ['gauges unread'], status: 'ready' } },
      query: 'zz',
      recentLabel: 'Recent',
      recents: [],
    })
    expect(answered).toHaveLength(1)
    expect(answered[0]?.notes).toEqual(['gauges unread'])
    expect(resultSummary(answered, 'zz')).toBe('No results from what was read; 1 source not read')
  })
})

describe('createSharedSearch', () => {
  it('makes one request for concurrent callers with the same query', async () => {
    const fetcher = vi.fn(async (query: string) => `answer:${query}`)
    const search = createSharedSearch(fetcher)
    const a = new AbortController()
    const b = new AbortController()
    const [one, two] = await Promise.all([search('miss', a.signal), search('miss', b.signal)])
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect([one, two]).toEqual(['answer:miss', 'answer:miss'])
  })

  it('aborts the request only when every caller has given up', async () => {
    let seen: AbortSignal | undefined
    const search = createSharedSearch(
      (_query, signal) =>
        new Promise<string>((_resolve, reject) => {
          seen = signal
          signal.addEventListener('abort', () => reject(new DOMException('x', 'AbortError')))
        }),
    )
    const a = new AbortController()
    const b = new AbortController()
    const first = search('q', a.signal)
    const second = search('q', b.signal)
    a.abort()
    await expect(first).rejects.toMatchObject({ name: 'AbortError' })
    expect(seen?.aborted).toBe(false)
    b.abort()
    await expect(second).rejects.toMatchObject({ name: 'AbortError' })
    expect(seen?.aborted).toBe(true)
  })

  it('does not call the fetcher again once the request has settled', async () => {
    const fetcher = vi.fn(async () => 'ok')
    const search = createSharedSearch(fetcher)
    await search('q', new AbortController().signal)
    await search('q', new AbortController().signal)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('passes a failure to every caller', async () => {
    const search = createSharedSearch(async () => {
      throw new Error('down')
    })
    const results = await Promise.allSettled([
      search('q', new AbortController().signal),
      search('q', new AbortController().signal),
    ])
    expect(results.map((result) => result.status)).toEqual(['rejected', 'rejected'])
  })
})

describe('createSearchRunner', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  function setup(search: NeCommandGroup['search'], extra: Partial<NeCommandGroup> = {}) {
    const states: Array<[string, NeCommandGroupState]> = []
    const group: NeCommandGroup = { id: 'g', label: 'G', search, ...extra }
    const runner = createSearchRunner({
      groups: () => [group],
      onState: (id, state) => states.push([id, state]),
    })
    const last = () => states.at(-1)?.[1]
    return { last, runner, states }
  }

  it('does not call a provider below its minimum length', () => {
    const search = vi.fn(async () => [])
    const { last, runner } = setup(search)
    runner.run('m')
    vi.advanceTimersByTime(1000)
    expect(search).not.toHaveBeenCalled()
    expect(last()?.status).toBe('idle')
  })

  it('waits out the debounce and calls once for a burst of typing', async () => {
    const search = vi.fn(async (query: string) => [{ id: query, label: query }])
    const { last, runner } = setup(search)
    runner.run('mi')
    vi.advanceTimersByTime(100)
    runner.run('mis')
    vi.advanceTimersByTime(100)
    runner.run('miss')
    expect(search).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(150)
    expect(search).toHaveBeenCalledTimes(1)
    expect(search).toHaveBeenCalledWith(
      'miss',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    expect(last()).toEqual({ items: [{ id: 'miss', label: 'miss' }], notes: [], status: 'ready' })
  })

  it('aborts the call in flight when the query moves on', async () => {
    const signals: AbortSignal[] = []
    const search = vi.fn(
      (_query: string, { signal }: { signal: AbortSignal }) =>
        new Promise<NeCommandItem[]>(() => {
          signals.push(signal)
        }),
    )
    const { runner } = setup(search)
    runner.run('mis')
    await vi.advanceTimersByTimeAsync(150)
    expect(signals).toHaveLength(1)
    runner.run('miss')
    expect(signals[0]?.aborted).toBe(true)
  })

  it('drops an answer for a query that is no longer current, even if the provider ignored the signal', async () => {
    const resolvers = new Map<string, (items: NeCommandItem[]) => void>()
    const search = vi.fn(
      (query: string) =>
        new Promise<NeCommandItem[]>((resolve) => {
          resolvers.set(query, resolve)
        }),
    )
    const { last, runner } = setup(search)
    runner.run('mis')
    await vi.advanceTimersByTimeAsync(150)
    runner.run('miss')
    await vi.advanceTimersByTimeAsync(150)
    resolvers.get('miss')?.([{ id: 'new', label: 'new' }])
    await vi.advanceTimersByTimeAsync(0)
    resolvers.get('mis')?.([{ id: 'old', label: 'old' }])
    await vi.advanceTimersByTimeAsync(0)
    expect(last()?.items.map((row) => row.id)).toEqual(['new'])
  })

  it('keeps the last answer on screen while the next is out', async () => {
    const search = vi.fn(async (query: string) => [{ id: query, label: query }])
    const { last, runner } = setup(search)
    runner.run('mis')
    await vi.advanceTimersByTimeAsync(150)
    runner.run('miss')
    expect(last()).toEqual({ items: [{ id: 'mis', label: 'mis' }], notes: [], status: 'loading' })
  })

  it('reports a failure as an error, never as an empty answer', async () => {
    const { last, runner } = setup(async () => {
      throw new Error('503')
    })
    runner.run('miss')
    await vi.advanceTimersByTimeAsync(150)
    expect(last()).toEqual({ items: [], status: 'error' })
  })

  it("carries a partial answer's notes, and does not cache it", async () => {
    const search = vi.fn(async (query: string) => ({
      items: [{ id: query, label: query }],
      notes: ['one source unread'],
    }))
    const { last, runner } = setup(search)
    runner.run('miss')
    await vi.advanceTimersByTimeAsync(150)
    expect(last()).toEqual({
      items: [{ id: 'miss', label: 'miss' }],
      notes: ['one source unread'],
      status: 'ready',
    })
    runner.run('missi')
    await vi.advanceTimersByTimeAsync(150)
    runner.run('miss')
    // Asked again rather than answered from the cache: the gap may have closed.
    expect(last()?.status).toBe('loading')
    await vi.advanceTimersByTimeAsync(150)
    expect(search).toHaveBeenCalledTimes(3)
  })

  it('answers a query it has already asked from its cache', async () => {
    const search = vi.fn(async (query: string) => [{ id: query, label: query }])
    const { last, runner } = setup(search)
    runner.run('miss')
    await vi.advanceTimersByTimeAsync(150)
    runner.run('missi')
    await vi.advanceTimersByTimeAsync(150)
    runner.run('miss')
    expect(last()?.status).toBe('ready')
    expect(search).toHaveBeenCalledTimes(2)
  })

  it('cancel stops pending work, and reset forgets answers', async () => {
    const search = vi.fn(async () => [])
    const { runner } = setup(search)
    runner.run('miss')
    runner.cancel()
    await vi.advanceTimersByTimeAsync(500)
    expect(search).not.toHaveBeenCalled()
    runner.run('miss')
    await vi.advanceTimersByTimeAsync(150)
    runner.reset()
    runner.run('miss')
    await vi.advanceTimersByTimeAsync(150)
    expect(search).toHaveBeenCalledTimes(2)
  })

  it('honours a group debounce and minimum length', async () => {
    const search = vi.fn(async () => [])
    const { runner } = setup(search, { debounceMs: 400, minQuery: 3 })
    runner.run('mi')
    await vi.advanceTimersByTimeAsync(1000)
    expect(search).not.toHaveBeenCalled()
    runner.run('mis')
    await vi.advanceTimersByTimeAsync(399)
    expect(search).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(search).toHaveBeenCalledTimes(1)
  })
})
