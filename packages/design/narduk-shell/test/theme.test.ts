import { createRequire } from 'node:module'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { NARDUK_SHELL_APP_CONFIG } from '../src/app-config'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const themeCss = readFileSync(join(packageRoot, 'theme.css'), 'utf8')
const readme = readFileSync(join(packageRoot, 'README.md'), 'utf8')

/* ------------------------------------------------------------------ *
 * Minimal CSS reading. `theme.css` is a flat custom-property sheet, so
 * a block reader beats pulling a parser into the package's runtime
 * dependency graph for one test.
 * ------------------------------------------------------------------ */

/** Declarations of one rule, keyed by property, in source order. */
function declarations(block: string): Map<string, string> {
  const found = new Map<string, string>()
  const withoutComments = block.replaceAll(/\/\*[\s\S]*?\*\//g, '')
  for (const [, property, value] of withoutComments.matchAll(/(--[a-z0-9-]+)\s*:([^;]+);/gi)) {
    // Whitespace is collapsed, and dropped just inside parentheses, so a value
    // Prettier wraps across lines (`--ne-hatch-soft`'s gradient) reads the same
    // as the one-line form the README table documents.
    found.set(
      property,
      value.trim().replaceAll(/\s+/g, ' ').replaceAll(/\(\s+/g, '(').replaceAll(/\s+\)/g, ')'),
    )
  }
  return found
}

/** The body of the first rule whose selector list matches `selector`. */
function ruleBody(css: string, selector: string): string {
  const start = css.indexOf(selector)
  expect(start, `selector not found in theme.css: ${selector}`).toBeGreaterThanOrEqual(0)
  const open = css.indexOf('{', start)
  expect(open, `selector has no block: ${selector}`).toBeGreaterThan(start)
  let depth = 0
  for (let index = open; index < css.length; index += 1) {
    if (css[index] === '{') depth += 1
    if (css[index] === '}') {
      depth -= 1
      if (depth === 0) return css.slice(open + 1, index)
    }
  }
  throw new Error(`unterminated block for selector: ${selector}`)
}

const lightBlock = ruleBody(themeCss, ':root,\n.light {')
const darkBlock = ruleBody(themeCss, '\n.dark {')
// Selector text only: Prettier normalises the attribute selector's quotes.
const autoBlock = ruleBody(themeCss, '[data-ne-scheme=')

const light = declarations(lightBlock)
const dark = declarations(darkBlock)
const auto = declarations(autoBlock)

/** What the token resolves to in a scheme: the dark block, else the light one. */
function resolved(scheme: Map<string, string>, token: string): string | undefined {
  return scheme.get(token) ?? light.get(token)
}

/* ------------------------------------------------------------------ *
 * WCAG 2.2 relative luminance and contrast. Written out rather than
 * imported so the regression test owns its own arithmetic.
 * ------------------------------------------------------------------ */

export function relativeLuminance(hex: string): number {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim())
  if (!match) throw new Error(`not a six-digit hex colour: ${hex}`)
  const channels = [0, 2, 4].map((offset) =>
    Number.parseInt(match[1]!.slice(offset, offset + 2), 16),
  )
  const linear = channels.map((channel) => {
    const value = channel / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!
}

export function contrastRatio(foreground: string, background: string): number {
  const a = relativeLuminance(foreground)
  const b = relativeLuminance(background)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

/** WCAG 2.2 AA for text under 18.66px bold / 24px regular. */
const AA_TEXT = 4.5
/** WCAG 2.2 AA for user-interface components and graphical objects. */
const AA_NON_TEXT = 3

/**
 * operator-portal#238: axe reported `text-muted` at #62748e on #edf0f4 as
 * 4.16:1 against a required 4.5:1 on the rendered `/login` card subtitle and
 * footer. Both values are the issue's, quoted verbatim.
 */
const OPERATOR_PORTAL_238 = { foreground: '#62748e', background: '#edf0f4' } as const

/* ------------------------------------------------------------------ *
 * The installed Nuxt UI, as evidence. Nothing about the `--ui-*` names
 * is hardcoded here: they are read out of the package on disk.
 * ------------------------------------------------------------------ */

const require_ = createRequire(import.meta.url)
const nuxtUiRoot = resolve(dirname(require_.resolve('@nuxt/ui/runtime/index.css')), '../..')

function textFiles(root: string, depth = 0): string[] {
  if (depth > 6) return []
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name)
    if (entry.isDirectory()) return textFiles(path, depth + 1)
    if (!/\.(?:css|mjs|js|ts|vue|json)$/.test(entry.name)) return []
    if (statSync(path).size > 4_000_000) return []
    return [path]
  })
}

/**
 * Every `--ui-*` the installed Nuxt UI declares or reads. Declarations come
 * from its theme sheet (`dist/runtime/index.css`), reads from `var(--ui-…)`
 * anywhere in the package — which is where `--ui-primary` and friends live,
 * since the colour plugin generates those names at runtime.
 */
function nuxtUiVariables(): { declared: Set<string>; known: Set<string> } {
  const declared = new Set<string>()
  const known = new Set<string>()
  const themeSheet = readFileSync(join(nuxtUiRoot, 'dist/runtime/index.css'), 'utf8')
  for (const [, name] of themeSheet.matchAll(/(--ui-[a-z0-9-]+)\s*:/gi)) {
    declared.add(name)
    known.add(name)
  }
  for (const file of textFiles(nuxtUiRoot)) {
    const source = readFileSync(file, 'utf8')
    for (const [, name] of source.matchAll(/var\(\s*(--ui-[a-z0-9-]+)/gi)) known.add(name)
  }
  return { declared, known }
}

const { declared: nuxtUiDeclared, known: nuxtUiKnown } = nuxtUiVariables()

/* ------------------------------------------------------------------ *
 * The README token table is the documented contract.
 * ------------------------------------------------------------------ */

interface TokenRow {
  token: string
  purpose: string
  lightValue: string
  darkValue: string
}

function readmeTokenTable(): TokenRow[] {
  const section = readme.slice(readme.indexOf('<!-- ne-token-table:start -->'))
  const body = section.slice(0, section.indexOf('<!-- ne-token-table:end -->'))
  const rows: TokenRow[] = []
  for (const line of body.split('\n')) {
    if (!line.trim().startsWith('| `--ne-')) continue
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim())
    expect(cells, `token row needs four cells: ${line}`).toHaveLength(4)
    rows.push({
      token: cells[0]!.replaceAll('`', ''),
      purpose: cells[1]!,
      lightValue: cells[2]!.replaceAll('`', ''),
      darkValue: cells[3]!.replaceAll('`', ''),
    })
  }
  return rows
}

const tokenTable = readmeTokenTable()

describe('theme.css token sheet', () => {
  it('documents a table that is neither empty nor a subset of the sheet', () => {
    expect(tokenTable.length).toBeGreaterThan(30)
    const documented = new Set(tokenTable.map((row) => row.token))
    const declaredLight = [...light.keys()].filter((name) => name.startsWith('--ne-'))
    expect([...declaredLight].sort()).toEqual([...documented].sort())
  })

  it('defines every documented token in both schemes, with the documented values', () => {
    for (const row of tokenTable) {
      expect(light.get(row.token), `${row.token} missing from the light block`).toBe(row.lightValue)
      expect(resolved(dark, row.token), `${row.token} unresolved in the dark scheme`).toBe(
        row.darkValue,
      )
      expect(row.purpose.length, `${row.token} has no documented purpose`).toBeGreaterThan(0)
    }
  })

  it('keeps the opt-in auto-dark block identical to the .dark block', () => {
    expect([...auto.entries()]).toEqual([...dark.entries()])
  })

  it('switches schemes the way the installed Nuxt UI does', () => {
    const nuxtUiTheme = readFileSync(join(nuxtUiRoot, 'dist/runtime/index.css'), 'utf8')
    // Nuxt UI 4 declares its light values on `.light, :host, :root` and its
    // dark values on `.dark`, with no media query anywhere in the sheet.
    expect(nuxtUiTheme).toMatch(/\.light\s*,\s*:host\s*,\s*:root\s*\{/)
    expect(nuxtUiTheme).toMatch(/\.dark\s*\{/)
    expect(nuxtUiTheme).not.toMatch(/prefers-color-scheme/)
    // So the sheet's own automatic block must be opt-in rather than a bare
    // `:root` media query that would fight `@nuxtjs/color-mode`.
    expect(themeCss).toMatch(
      /@media \(prefers-color-scheme: dark\) \{\s*:root\[data-ne-scheme=["']auto["']\]/,
    )
    expect(themeCss).not.toMatch(/@media \(prefers-color-scheme: dark\) \{\s*:root\s*\{/)
  })

  it('ships no external asset, so a static export of it stays self-contained', () => {
    // design-system-build's renderBundle refuses a stylesheet with either.
    expect(themeCss).not.toMatch(/@import\s/)
    expect(themeCss).not.toMatch(/url\(\s*['"]?(?!data:)/i)
  })
})

/**
 * narduk-libs#602: the unreported treatment. The hatch is material, not a
 * colour — it has to follow the scheme and any override of the ink and line
 * tokens without a colour of its own, and it has to stay 1px diagonals, which
 * is what makes it read as "no magnitude" rather than as a short bar.
 */
describe('the unreported material (--ne-hatch)', () => {
  const HATCHES = {
    '--ne-hatch': '--ne-ink-dimmed',
    '--ne-hatch-soft': '--ne-line-strong',
  } as const

  it.each(Object.entries(HATCHES))(
    '%s is a 1px diagonal hatch drawn in %s, declared identically in every scheme',
    (token, ink) => {
      const value = light.get(token)
      expect(value, `${token} missing from the light block`).toBe(
        `repeating-linear-gradient(135deg, var(${ink}) 0 1px, transparent 1px 6px)`,
      )
      // Declared again (not inherited) in `.dark`, so a `var()` inside it
      // resolves against a pinned `<div class="dark">` subtree's own ink.
      expect(dark.get(token)).toBe(value)
      expect(auto.get(token)).toBe(value)
      expect(light.has(ink), `${token} reads undefined ${ink}`).toBe(true)
    },
  )

  it('carries no colour literal: every colour in it is a token read or transparent', () => {
    for (const token of Object.keys(HATCHES)) {
      const withoutReads = light.get(token)!.replaceAll(/var\(--ne-[a-z0-9-]+\)/g, '')
      expect(withoutReads).not.toMatch(/#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|oklch)\s*\(/i)
    }
  })

  it('documents the CSS contract a figure component follows', () => {
    expect(readme).toMatch(/### The unreported treatment/)
    expect(readme).toMatch(/background-image: var\(--ne-hatch\)/)
  })
})

describe('--ui-* bridge', () => {
  const bridged = [...light.keys()].filter((name) => name.startsWith('--ui-'))

  it('reads the installed Nuxt UI rather than a copied list', () => {
    // Sanity: if the parse found nothing, every assertion below is vacuous.
    expect(nuxtUiDeclared.size).toBeGreaterThan(10)
    expect(nuxtUiKnown.size).toBeGreaterThanOrEqual(nuxtUiDeclared.size)
    for (const anchor of ['--ui-bg', '--ui-text', '--ui-border', '--ui-radius']) {
      expect(nuxtUiDeclared.has(anchor), `${anchor} not found in the installed theme`).toBe(true)
    }
    expect(nuxtUiKnown.has('--ui-primary')).toBe(true)
  })

  it('targets only variables the installed Nuxt UI actually reads', () => {
    expect(bridged.length).toBeGreaterThan(10)
    for (const target of bridged) {
      expect(nuxtUiKnown.has(target), `${target} is not a variable Nuxt UI 4 reads`).toBe(true)
    }
  })

  it('points every target at an NE token that the sheet defines', () => {
    for (const target of bridged) {
      const value = light.get(target)!
      const [, token] = /^var\((--ne-[a-z0-9-]+)\)$/.exec(value) ?? []
      expect(token, `${target} should be var(--ne-…), got ${value}`).toBeTruthy()
      expect(light.has(token!), `${target} points at undefined ${token}`).toBe(true)
    }
  })

  it('bridges the same targets in both schemes', () => {
    const darkBridged = [...dark.keys()].filter((name) => name.startsWith('--ui-'))
    expect(darkBridged.sort()).toEqual([...bridged].sort())
    for (const target of bridged) expect(dark.get(target)).toBe(light.get(target))
  })

  it('leaves the colour aliases to app.config, where the shade scale lives', () => {
    for (const alias of ['primary', 'secondary', 'success', 'info', 'warning', 'error']) {
      expect(light.has(`--ui-${alias}`), `--ui-${alias} must not be bridged`).toBe(false)
    }
    expect(NARDUK_SHELL_APP_CONFIG).toEqual({
      ui: { colors: { primary: 'sky', neutral: 'slate' } },
    })
  })

  /**
   * The exact structural mapping. Existence of a `--ui-*` declaration is not
   * enough: a later edit that pointed `--ui-text-muted` at `--ne-ink-dimmed`
   * would still "bridge something" and would ship the operator-portal#238
   * failure again.
   */
  const UI_TO_NE = {
    '--ui-bg': '--ne-surface',
    '--ui-bg-muted': '--ne-surface-muted',
    '--ui-bg-elevated': '--ne-surface-elevated',
    '--ui-bg-accented': '--ne-surface-accented',
    '--ui-bg-inverted': '--ne-surface-inverted',
    '--ui-text-highlighted': '--ne-ink',
    '--ui-text': '--ne-ink-body',
    '--ui-text-toned': '--ne-ink-secondary',
    '--ui-text-muted': '--ne-ink-muted',
    '--ui-text-dimmed': '--ne-ink-dimmed',
    '--ui-text-inverted': '--ne-ink-inverted',
    '--ui-border': '--ne-hairline',
    '--ui-border-muted': '--ne-divider',
    '--ui-border-accented': '--ne-line-strong',
    '--ui-border-inverted': '--ne-line-inverted',
    '--ui-radius': '--ne-radius-base',
    '--ui-container': '--ne-container',
    '--ui-header-height': '--ne-header-height',
  } as const

  it('maps each --ui-* target onto a specific NE token, not merely some token', () => {
    expect([...bridged].sort()).toEqual(Object.keys(UI_TO_NE).sort())
    for (const [target, token] of Object.entries(UI_TO_NE)) {
      expect(light.get(target)).toBe(`var(${token})`)
      expect(dark.get(target)).toBe(`var(${token})`)
    }
  })
})

describe('contrast regression (operator-portal#238)', () => {
  it('uses the class that failed: Nuxt UI text-muted reads --ui-text-muted', () => {
    // operator-portal#238 named the class on both failing <p>s:
    // `class="text-center text-sm text-muted"`. Nuxt UI 4 turns that colour
    // name into `--color-muted: var(--ui-text-muted)`, which is what
    // Tailwind's `text-muted` utility paints with.
    const themeSheet = readFileSync(join(nuxtUiRoot, 'dist/runtime/index.css'), 'utf8')
    const mentionsClass = [...textFiles(nuxtUiRoot)].some((path) => {
      const source = readFileSync(path, 'utf8')
      return (
        source.includes('text-muted') &&
        (source.includes('--ui-text-muted') || source.includes('--color-muted'))
      )
    })
    expect(
      mentionsClass ||
        /--color-muted\s*:\s*var\(--ui-text-muted\)/.test(themeSheet) ||
        /text-muted/.test(themeSheet),
      'installed Nuxt UI no longer ties the text-muted class to --ui-text-muted',
    ).toBe(true)
    expect(nuxtUiDeclared.has('--ui-text-muted')).toBe(true)
    expect(light.get('--ui-text-muted')).toBe('var(--ne-ink-muted)')
    expect(dark.get('--ui-text-muted')).toBe('var(--ne-ink-muted)')
  })

  it('reproduces the reported failure, so the helper measures something real', () => {
    const measured = contrastRatio(OPERATOR_PORTAL_238.foreground, OPERATOR_PORTAL_238.background)
    // The issue quotes axe's 4.16; axe truncates, this helper does not.
    expect(measured).toBeGreaterThan(4.1)
    expect(measured).toBeLessThan(4.2)
    expect(measured).toBeLessThan(AA_TEXT)
  })

  it('never ships the failing pair as a default token', () => {
    for (const scheme of [light, dark, auto]) {
      for (const [token, value] of scheme) {
        if (!token.startsWith('--ne-')) continue
        expect(value.toLowerCase()).not.toBe(OPERATOR_PORTAL_238.foreground)
        expect(value.toLowerCase()).not.toBe(OPERATOR_PORTAL_238.background)
      }
    }
  })

  const surfaces = [
    '--ne-ground',
    '--ne-surface',
    '--ne-surface-muted',
    '--ne-surface-elevated',
    '--ne-surface-accented',
  ]
  const bodyInks = ['--ne-ink', '--ne-ink-body', '--ne-ink-secondary', '--ne-ink-muted']
  const schemes = [
    { name: 'light', values: light },
    { name: 'dark', values: dark },
  ] as const

  it.each(schemes)('keeps every body ink on every surface at AA in $name', ({ values }) => {
    for (const ink of bodyInks) {
      for (const surface of surfaces) {
        const foreground = resolved(values, ink)!
        const background = resolved(values, surface)!
        const ratio = contrastRatio(foreground, background)
        expect(
          ratio,
          `${ink} (${foreground}) on ${surface} (${background}) is ${ratio.toFixed(2)}:1`,
        ).toBeGreaterThanOrEqual(AA_TEXT)
      }
    }
  })

  it.each(schemes)(
    'keeps the accent legible on the ground and its own ink in $name',
    ({ values }) => {
      const ground = resolved(values, '--ne-ground')!
      const surface = resolved(values, '--ne-surface')!
      const accent = resolved(values, '--ne-accent')!
      const accentInk = resolved(values, '--ne-accent-ink')!
      expect(contrastRatio(accent, ground)).toBeGreaterThanOrEqual(AA_TEXT)
      expect(contrastRatio(accent, surface)).toBeGreaterThanOrEqual(AA_TEXT)
      expect(contrastRatio(accentInk, accent)).toBeGreaterThanOrEqual(AA_TEXT)
    },
  )

  it.each(schemes)('keeps inverted and structural chrome legible in $name', ({ values }) => {
    expect(
      contrastRatio(
        resolved(values, '--ne-ink-inverted')!,
        resolved(values, '--ne-surface-inverted')!,
      ),
    ).toBeGreaterThanOrEqual(AA_TEXT)
    expect(
      contrastRatio(resolved(values, '--ne-structure-ink')!, resolved(values, '--ne-structure')!),
    ).toBeGreaterThanOrEqual(AA_TEXT)
  })

  it.each(schemes)(
    'holds dimmed ink to the non-text floor only, and says so in $name',
    ({ values }) => {
      const dimmed = resolved(values, '--ne-ink-dimmed')!
      const surface = resolved(values, '--ne-surface')!
      const ratio = contrastRatio(dimmed, surface)
      expect(ratio).toBeGreaterThanOrEqual(AA_NON_TEXT)
      expect(ratio).toBeLessThan(AA_TEXT)
      expect(readme).toMatch(/never body text/i)
    },
  )

  it('would fail if a muted ink were set back to the operator-portal#238 pair', () => {
    // The guard above is a value check; this is the behavioural one. Swapping
    // the shipped muted ink and elevated surface for #238's pair must break
    // the same assertion the suite runs for real.
    const regressed = contrastRatio(OPERATOR_PORTAL_238.foreground, OPERATOR_PORTAL_238.background)
    expect(regressed).toBeLessThan(AA_TEXT)
    const shipped = contrastRatio(light.get('--ne-ink-muted')!, light.get('--ne-surface-elevated')!)
    expect(shipped).toBeGreaterThanOrEqual(AA_TEXT)
  })
})

describe('styling contract', () => {
  it('is stated in the README, with the override recipe and the exclusions', () => {
    expect(readme).toMatch(/## Styling contract/)
    expect(readme).toMatch(/never hardcode a colour, radius, shadow or font/i)
    expect(readme).toMatch(/--ne-accent/)
    expect(readme).toMatch(/--ne-structure/)
    expect(readme).toMatch(/deliberately not themed/i)
  })
})
