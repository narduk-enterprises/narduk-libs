/**
 * The command palette's engine: the parts with no DOM and no Vue.
 *
 * Match scoring, grouping into sections, the keyboard walk, recent items, the
 * async provider runner (debounce, cancel, stale-answer suppression) and a
 * shared search for several groups answered by one request. They are plain
 * functions so the ranking and the grouping are unit tested directly, and so
 * `NeCommandPalette` stays a thin view over them.
 */
import type {
  NeCommandAnswer,
  NeCommandGroup,
  NeCommandGroupState,
  NeCommandItem,
  NeCommandRecent,
  NeCommandRow,
  NeCommandSection,
} from '../components/ne-command-palette-types'

export const NE_PALETTE_DEFAULT_LIMIT = 5
export const NE_PALETTE_DEFAULT_MIN_QUERY = 2
export const NE_PALETTE_DEFAULT_DEBOUNCE_MS = 150
export const NE_PALETTE_RECENT_GROUP = '__recent'

// ----------------------------------------------------------------- matching

function noop() {}

/** Lower case, accents folded, runs of space collapsed. */
export function normalizeQuery(value: string): string {
  return value
    .normalize('NFD')
    .replaceAll(/\p{M}/gu, '')
    .toLowerCase()
    .replaceAll(/\s+/g, ' ')
    .trim()
}

export function queryTokens(query: string): string[] {
  const normalized = normalizeQuery(query)
  return normalized ? normalized.split(' ') : []
}

/** Where `token` sits in `text`: 3 at the start, 2 at a word start, 1 inside, 0 absent. */
function position(text: string, token: string): 0 | 1 | 2 | 3 {
  const at = text.indexOf(token)
  if (at < 0) return 0
  if (at === 0) return 3
  return /[\s\-_/.,()]/.test(text.charAt(at - 1)) ? 2 : 1
}

/**
 * How well `item` answers `query`; `0` means it does not. Every word of the
 * query must be found somewhere in the row (label, keywords or description),
 * so "miss river" finds "Mississippi River" and not "Missoula". Within that:
 * the title beats a keyword, which beats the description, and a match at the
 * start of the title or of one of its words beats one in the middle.
 */
export function scoreItem(item: NeCommandItem, query: string): number {
  const tokens = queryTokens(query)
  if (tokens.length === 0) return 1
  const label = normalizeQuery(item.label)
  const description = normalizeQuery(item.description ?? '')
  const keywords = (item.keywords ?? []).map(normalizeQuery)
  let score = 0
  for (const token of tokens) {
    let best = 0
    const inLabel = position(label, token)
    if (inLabel) best = Math.max(best, [0, 50, 70, 90][inLabel] ?? 0)
    for (const keyword of keywords) {
      if (keyword === token) best = Math.max(best, 95)
      else {
        const inKeyword = position(keyword, token)
        if (inKeyword) best = Math.max(best, [0, 30, 40, 60][inKeyword] ?? 0)
      }
    }
    if (position(description, token)) best = Math.max(best, 20)
    if (best === 0) return 0
    score += best
  }
  const whole = tokens.join(' ')
  if (label === whole) score += 100
  else if (keywords.includes(whole)) score += 60
  else if (label.startsWith(whole)) score += 40
  return score
}

export interface NeMatchOptions {
  /** Keep this many. Default none (all). */
  limit?: number
  /** `source` keeps the given order and still drops rows that do not match. */
  rank?: 'match' | 'source'
}

/**
 * The rows of `items` that answer `query`, best first. Ties keep their given
 * order, so an app's own ordering (a list sorted by size) decides among equals.
 * With an empty query every row stays, in order.
 */
export function matchItems(
  items: readonly NeCommandItem[],
  query: string,
  options: NeMatchOptions = {},
): NeCommandItem[] {
  const scored = items.map((item, order) => ({ item, order, score: scoreItem(item, query) }))
  const kept = scored.filter((entry) => entry.score > 0)
  if (options.rank !== 'source') {
    kept.sort((a, b) => b.score - a.score || a.order - b.order)
  }
  const rows = kept.map((entry) => entry.item)
  return options.limit === undefined ? rows : rows.slice(0, Math.max(0, options.limit))
}

export interface NeHighlightPart {
  text: string
  hit: boolean
}

/**
 * `text` cut into parts, the parts that match a query word marked. Case and
 * accents are ignored; the original text is what comes back.
 */
export function highlightParts(text: string, query: string): NeHighlightPart[] {
  const tokens = queryTokens(query)
  if (tokens.length === 0 || !text) return [{ text, hit: false }]
  // Fold accents one code point at a time so offsets still line up with `text`.
  const folded = Array.from(text, (char) => normalizeQuery(char) || char.toLowerCase()).join('')
  if (folded.length !== text.length) return [{ text, hit: false }]
  const marks = new Array<boolean>(text.length).fill(false)
  for (const token of tokens) {
    let from = 0
    for (;;) {
      const at = folded.indexOf(token, from)
      if (at < 0) break
      for (let i = at; i < at + token.length; i++) marks[i] = true
      from = at + token.length
    }
  }
  const parts: NeHighlightPart[] = []
  for (let i = 0; i < text.length; i++) {
    const hit = marks[i] === true
    const last = parts.at(-1)
    if (last && last.hit === hit) last.text += text.charAt(i)
    else parts.push({ text: text.charAt(i), hit })
  }
  return parts
}

// ----------------------------------------------------------------- sections

function groupRows(
  sectionId: string,
  entries: ReadonlyArray<{ groupId: string; item: NeCommandItem }>,
  start: number,
) {
  const seen = new Set<string>()
  const rows: NeCommandRow[] = []
  for (const { groupId, item } of entries) {
    const key = `${sectionId}:${groupId}:${item.id}`
    if (seen.has(key)) continue
    seen.add(key)
    rows.push({ groupId, index: start + rows.length, item, key })
  }
  return rows
}

export interface NeBuildSectionsInput {
  groups: readonly NeCommandGroup[]
  query: string
  /** Each async group's last answer, by group id. */
  providers: Readonly<Record<string, NeCommandGroupState | undefined>>
  recents: readonly NeCommandRecent[]
  recentLabel: string
}

/**
 * The palette's sections, in order, each row numbered in the one flat sequence
 * the arrow keys walk.
 *
 * - No query: recent items first, then every group that offers rows before a
 *   query (`idleLimit`), each cut to its `idleLimit`.
 * - A query: each group's own rows (ranked, or in provider order), cut to its
 *   `limit`; groups with nothing to show are left out, except a provider that
 *   is out (shown loading) or failed (shown unavailable).
 */
export function buildSections(input: NeBuildSectionsInput): NeCommandSection[] {
  const query = normalizeQuery(input.query)
  const sections: NeCommandSection[] = []
  let next = 0
  const add = (
    section: Pick<NeCommandSection, 'id' | 'label' | 'status' | 'recent'>,
    entries: ReadonlyArray<{ groupId: string; item: NeCommandItem }>,
    notes: readonly string[] = [],
  ) => {
    const rows = groupRows(section.id, entries, next)
    if (rows.length === 0 && notes.length === 0 && section.status === 'ready') return
    next += rows.length
    sections.push({ ...section, notes, rows })
  }

  if (!query) {
    add(
      { id: NE_PALETTE_RECENT_GROUP, label: input.recentLabel, recent: true, status: 'ready' },
      input.recents.map((recent) => ({ groupId: recent.groupId, item: recent.item })),
    )
    for (const group of input.groups) {
      const idle = group.idleLimit ?? 0
      if (idle <= 0) continue
      add(
        { id: group.id, label: group.label, status: 'ready' },
        resolveItems(group, '')
          .slice(0, idle)
          .map((item) => ({ groupId: group.id, item })),
      )
    }
    return sections
  }

  for (const group of input.groups) {
    const limit = group.limit ?? NE_PALETTE_DEFAULT_LIMIT
    let items: readonly NeCommandItem[] = matchItems(
      resolveItems(group, input.query),
      input.query,
      { limit, rank: group.rank ?? 'match' },
    )
    let status: NeCommandSection['status'] = 'ready'
    let notes: readonly string[] = []
    if (group.search) {
      const state = input.providers[group.id]
      const answered = state?.items ?? []
      const provided =
        group.rank === 'match'
          ? matchItems(answered, input.query, { limit, rank: 'match' })
          : answered.slice(0, limit)
      items = dedupe([...items, ...provided]).slice(0, limit)
      if (state?.status === 'loading') status = 'loading'
      else if (state?.status === 'error') status = 'error'
      if (state?.status !== 'error') notes = state?.notes ?? []
    }
    add(
      { id: group.id, label: group.label, status },
      items.map((item) => ({ groupId: group.id, item })),
      notes,
    )
  }
  return sections
}

function dedupe(items: readonly NeCommandItem[]): NeCommandItem[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    if (seen.has(item.id)) return false
    seen.add(item.id)
    return true
  })
}

function resolveItems(group: NeCommandGroup, query: string): readonly NeCommandItem[] {
  const own = group.items
  if (!own) return []
  return typeof own === 'function' ? own(query) : own
}

/** All rows of all sections, in keyboard order. */
export function flattenRows(sections: readonly NeCommandSection[]): NeCommandRow[] {
  return sections.flatMap((section) => section.rows)
}

/** How many groups have rows, for the screen-reader summary. */
export function resultSummary(sections: readonly NeCommandSection[], query: string): string {
  const total = sections.reduce((sum, section) => sum + section.rows.length, 0)
  if (!normalizeQuery(query)) return ''
  const notes = sections.reduce((sum, section) => sum + section.notes.length, 0)
  const unread = notes === 0 ? '' : `; ${notes} ${notes === 1 ? 'source' : 'sources'} not read`
  if (total === 0) return notes === 0 ? 'No results' : `No results from what was read${unread}`
  const parts = sections
    .filter((section) => section.rows.length > 0)
    .map((section) => `${section.rows.length} ${section.label.toLowerCase()}`)
  return `${total} ${total === 1 ? 'result' : 'results'}: ${parts.join(', ')}${unread}`
}

// -------------------------------------------------------------- keyboard walk

/**
 * The next active row. `-1` is "none", so a fresh list starts nowhere and the
 * first Down lands on row 0. It wraps both ways. An empty list has no active row.
 */
export function moveActive(current: number, delta: number, total: number): number {
  if (total <= 0) return -1
  if (current < 0) return delta >= 0 ? 0 : total - 1
  return (((current + delta) % total) + total) % total
}

/** Page keys step by this many rows, clamped to the ends rather than wrapping. */
export function pageActive(current: number, delta: number, total: number): number {
  if (total <= 0) return -1
  const from = current < 0 ? (delta > 0 ? -1 : total) : current
  return Math.min(total - 1, Math.max(0, from + delta))
}

// ------------------------------------------------------------------- recents

/** A remembered row with no live fields (a badge goes stale, so it is not kept). */
export function toRecent(groupId: string, item: NeCommandItem): NeCommandRecent {
  const stored: NeCommandRecent['item'] = { id: item.id, label: item.label }
  if (item.description) stored.description = item.description
  if (item.icon) stored.icon = item.icon
  if (item.to) stored.to = item.to
  if (item.actions?.length) stored.actions = item.actions.map((action) => ({ ...action }))
  return { groupId, item: stored }
}

/** `recent` first, an earlier copy of the same row dropped, at most `max` kept. */
export function rememberRecent(
  list: readonly NeCommandRecent[],
  recent: NeCommandRecent,
  max: number,
): NeCommandRecent[] {
  if (max <= 0) return []
  const rest = list.filter(
    (entry) => !(entry.groupId === recent.groupId && entry.item.id === recent.item.id),
  )
  return [recent, ...rest].slice(0, max)
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

/** Parsed storage, with anything that is not a well-formed entry dropped. */
export function sanitizeRecents(raw: unknown, max: number): NeCommandRecent[] {
  if (!Array.isArray(raw) || max <= 0) return []
  const out: NeCommandRecent[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const { groupId, item } = entry as { groupId?: unknown; item?: unknown }
    if (!isText(groupId) || !item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    if (!isText(record.id) || !isText(record.label)) continue
    const stored: NeCommandRecent['item'] = { id: record.id, label: record.label }
    if (isText(record.description)) stored.description = record.description
    if (isText(record.icon)) stored.icon = record.icon
    if (isText(record.to)) stored.to = record.to
    if (Array.isArray(record.actions)) {
      const actions = record.actions.flatMap((action) => {
        if (!action || typeof action !== 'object') return []
        const a = action as Record<string, unknown>
        if (!isText(a.id) || !isText(a.label)) return []
        return [
          {
            id: a.id,
            label: a.label,
            ...(isText(a.icon) ? { icon: a.icon } : {}),
            ...(isText(a.to) ? { to: a.to } : {}),
          },
        ]
      })
      if (actions.length > 0) stored.actions = actions
    }
    out.push({ groupId, item: stored })
    if (out.length >= max) break
  }
  return out
}

// ------------------------------------------------------------- shared search

/**
 * One request for several groups. Rivers, gauges and states often come from one
 * endpoint; each group still has its own provider, and they all call the
 * function this returns. Concurrent calls for the same query share one
 * request, and the request is aborted only when every caller has given up.
 */
export function createSharedSearch<T>(
  fetcher: (query: string, signal: AbortSignal) => Promise<T>,
): (query: string, signal: AbortSignal) => Promise<T> {
  const inflight = new Map<
    string,
    { callers: number; controller: AbortController; promise: Promise<T> }
  >()
  return (query, signal) => {
    let entry = inflight.get(query)
    if (!entry) {
      const controller = new AbortController()
      const made = {
        callers: 0,
        controller,
        promise: fetcher(query, controller.signal),
      }
      entry = made
      inflight.set(query, made)
      const clear = () => {
        if (inflight.get(query) === made) inflight.delete(query)
      }
      made.promise.finally(clear).catch(noop)
    }
    const shared = entry
    shared.callers += 1
    return new Promise<T>((resolve, reject) => {
      let settled = false
      const release = () => {
        shared.callers -= 1
        if (shared.callers <= 0) {
          shared.controller.abort()
          if (inflight.get(query) === shared) inflight.delete(query)
        }
      }
      const onAbort = () => {
        if (settled) return
        settled = true
        release()
        reject(new DOMException('Aborted', 'AbortError'))
      }
      if (signal.aborted) {
        onAbort()
        return
      }
      signal.addEventListener('abort', onAbort, { once: true })
      shared.promise
        .then((value) => {
          if (settled) return value
          settled = true
          signal.removeEventListener('abort', onAbort)
          shared.callers -= 1
          resolve(value)
          return value
        })
        .catch((error: unknown) => {
          if (settled) return
          settled = true
          signal.removeEventListener('abort', onAbort)
          shared.callers -= 1
          reject(error)
        })
    })
  }
}

// ----------------------------------------------------------------- the runner

export interface NeSearchRunner {
  /** Start (or restart) every provider for this query. */
  run(query: string): void
  /** Abort everything in flight and forget pending timers. Answers are kept. */
  cancel(): void
  /** Abort, and drop all answers. */
  reset(): void
}

export interface NeSearchRunnerOptions {
  groups: () => readonly NeCommandGroup[]
  /** Called with a group's new state, whenever it changes. */
  onState: (groupId: string, state: NeCommandGroupState) => void
  /** Recent answers are reused for the same query. Default 24 per runner. */
  cacheSize?: number
}

/** A provider's answer, either shape, as rows plus notes. */
export function readAnswer(answer: readonly NeCommandItem[] | NeCommandAnswer): {
  items: readonly NeCommandItem[]
  notes: readonly string[]
} {
  if (Array.isArray(answer)) return { items: answer, notes: [] }
  const shaped = answer as NeCommandAnswer
  return { items: shaped.items, notes: shaped.notes ?? [] }
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

/**
 * Drives the async providers: each group is debounced on its own, a new query
 * aborts the one before it, and an answer for a query that is no longer the
 * current one is dropped even if the provider ignored the signal. Backing up
 * over a query already asked is answered from a small cache, so it is instant.
 */
export function createSearchRunner(options: NeSearchRunnerOptions): NeSearchRunner {
  const running = new Map<
    string,
    { controller?: AbortController; timer?: ReturnType<typeof setTimeout> }
  >()
  type Answer = { items: readonly NeCommandItem[]; notes: readonly string[] }
  const cache = new Map<string, Answer>()
  const last = new Map<string, Answer>()
  const cacheSize = options.cacheSize ?? 24
  let current = ''

  function stop(groupId: string) {
    const live = running.get(groupId)
    if (!live) return
    if (live.timer !== undefined) clearTimeout(live.timer)
    live.controller?.abort()
    running.delete(groupId)
  }

  function remember(key: string, answer: Answer) {
    // A partial answer is not cached: asking again may well answer in full.
    if (answer.notes.length > 0) return
    cache.delete(key)
    cache.set(key, answer)
    if (cache.size > cacheSize) cache.delete(cache.keys().next().value as string)
  }

  return {
    run(query) {
      const normalized = normalizeQuery(query)
      current = normalized
      for (const group of options.groups()) {
        if (!group.search) continue
        stop(group.id)
        const min = group.minQuery ?? NE_PALETTE_DEFAULT_MIN_QUERY
        if (normalized.length < min) {
          last.delete(group.id)
          options.onState(group.id, { items: [], status: 'idle' })
          continue
        }
        const key = `${group.id}\u0000${normalized}`
        const cached = cache.get(key)
        if (cached) {
          last.set(group.id, cached)
          options.onState(group.id, { ...cached, status: 'ready' })
          continue
        }
        // The last answer stays up while the next is out, so typing does not blink the list.
        const previous = last.get(group.id)
        options.onState(group.id, {
          items: previous?.items ?? [],
          notes: previous?.notes ?? [],
          status: 'loading',
        })
        const slot: { controller?: AbortController; timer?: ReturnType<typeof setTimeout> } = {}
        running.set(group.id, slot)
        slot.timer = setTimeout(() => {
          slot.timer = undefined
          const controller = new AbortController()
          slot.controller = controller
          const { search } = group
          if (!search) return
          // `query` as typed, trimmed: a provider may want the user's own casing.
          search(query.trim(), { signal: controller.signal })
            .then((raw) => {
              const answer = readAnswer(raw)
              if (controller.signal.aborted || current !== normalized) return answer
              running.delete(group.id)
              remember(key, answer)
              last.set(group.id, answer)
              options.onState(group.id, { ...answer, status: 'ready' })
              return answer
            })
            .catch((error: unknown) => {
              if (controller.signal.aborted || current !== normalized || isAbort(error)) return
              running.delete(group.id)
              last.delete(group.id)
              options.onState(group.id, { items: [], status: 'error' })
            })
        }, group.debounceMs ?? NE_PALETTE_DEFAULT_DEBOUNCE_MS)
      }
    },
    cancel() {
      for (const id of [...running.keys()]) stop(id)
    },
    reset() {
      for (const id of [...running.keys()]) stop(id)
      cache.clear()
      last.clear()
      current = ''
    },
  }
}
