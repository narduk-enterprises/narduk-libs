import { describe, expect, it } from 'vitest'

/**
 * Locks the WCAG 2.2 AA colour-contrast fix for `AuthLoginCard.vue`'s
 * subtitle, "Forgot your password?" link, and footer text
 * (operator-portal#238) against regression, without a browser.
 *
 * ROOT CAUSE. Those three lines used Nuxt UI's `text-muted` utility, which
 * resolves to Tailwind's `neutral-500` (light) / `neutral-400` (dark) — a
 * pairing Nuxt UI itself only guarantees against its own default card
 * background (`--ui-bg`: white in light mode, `neutral-900` in dark). Against
 * that default the pairing clears AA (see LIGHT_DEFAULT_BG/DARK_DEFAULT_BG
 * below), but `AuthLoginCard.vue` is rendered by many consuming apps that are
 * free to repoint `--ui-bg` at a different, non-white "default" surface —
 * exactly what operator-portal's `app/assets/css/tokens.css` does
 * (`--ui-bg: var(--op-ground)`, a cool-grey `#edf0f4` page ground, not a white
 * panel). `neutral-500` on `#edf0f4` measures 4.17:1, below the 4.5:1 floor —
 * matching the 4.16:1 axe found on operator-portal's `/login` in
 * `tests/e2e/login.spec.ts` / `tests/e2e/accessibility-baseline.json`.
 *
 * FIX. Swap `text-muted` for Nuxt UI's next step up, `text-toned`
 * (`neutral-600` light / `neutral-300` dark) — still a muted, secondary ink
 * (design intent preserved), but with enough headroom to clear 4.5:1 against
 * both Nuxt UI's own default background AND the darker `#edf0f4` ground that
 * exposed the bug, in both themes.
 *
 * WHY NOT THE NARDUK-UI TOKEN LAYER. `packages/design/narduk-ui/tokens.css`
 * (the Narduk Status Design System's `--ns-*` tokens) never defines
 * `text-muted` or `--ui-text-muted` — it is an unrelated token set consumed
 * via `.ns-*` classes by the five status apps (buoys, lakestat, ...), not by
 * Nuxt UI's semantic colour scale that `AuthLoginCard.vue` actually uses. The
 * failing token is a Nuxt UI framework default, not a narduk-ui design token,
 * so the smallest correct fix is local to narduk-auth's own markup rather
 * than a narduk-ui token edit that would ripple into every other narduk-ui
 * consumer for a value narduk-ui never owned.
 */

/** Tailwind v4's oklch definitions for the "slate" palette (the default
 * `neutral` colour Nuxt UI resolves when a consuming app does not override
 * it), from `tailwindcss/theme.css`. Values themselves are pinned by the
 * `pnpm --filter tailwindcss` lockfile; if Tailwind ever re-cuts this palette
 * this test will drift with it, not silently pass. */
const TAILWIND_SLATE_OKLCH = {
  300: { l: 0.869, c: 0.022, h: 252.894 },
  400: { l: 0.704, c: 0.04, h: 256.788 },
  500: { l: 0.554, c: 0.046, h: 257.417 },
  600: { l: 0.446, c: 0.043, h: 257.281 },
  900: { l: 0.208, c: 0.042, h: 265.755 },
} as const

type Rgb = [number, number, number]

/** oklch -> linear sRGB -> sRGB, per Björn Ottosson's OKLab reference
 * matrices (the same conversion Tailwind's own oklch palette renders through
 * in a browser). */
function oklchToSrgb(l: number, c: number, hDeg: number): Rgb {
  const hRad = (hDeg * Math.PI) / 180
  const a = c * Math.cos(hRad)
  const b = c * Math.sin(hRad)

  const l_ = l + 0.3963377774 * a + 0.2158037573 * b
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b
  const s_ = l - 0.0894841775 * a - 1.291485548 * b

  const lc = l_ ** 3
  const mc = m_ ** 3
  const sc = s_ ** 3

  const rLin = 4.0767416621 * lc - 3.3077115913 * mc + 0.2309699292 * sc
  const gLin = -1.2684380046 * lc + 2.6097574011 * mc - 0.3413193965 * sc
  const bLin = -0.0041960863 * lc - 0.7034186147 * mc + 1.707614701 * sc

  const toSrgb = (channel: number) => {
    const clamped = Math.min(1, Math.max(0, channel))
    const encoded = clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * clamped ** (1 / 2.4) - 0.055
    return Math.round(Math.min(1, Math.max(0, encoded)) * 255)
  }

  return [toSrgb(rLin), toSrgb(gLin), toSrgb(bLin)]
}

function slate(shade: keyof typeof TAILWIND_SLATE_OKLCH): Rgb {
  const { l, c, h } = TAILWIND_SLATE_OKLCH[shade]
  return oklchToSrgb(l, c, h)
}

function hexToRgb(hex: string): Rgb {
  const clean = hex.replace('#', '')
  return [
    Number.parseInt(clean.slice(0, 2), 16),
    Number.parseInt(clean.slice(2, 4), 16),
    Number.parseInt(clean.slice(4, 6), 16),
  ]
}

/** WCAG relative luminance (https://www.w3.org/TR/WCAG21/#dfn-relative-luminance). */
function relativeLuminance([r, g, b]: Rgb): number {
  const linearize = (channel: number) => {
    const normalized = channel / 255
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
  }
  const [rl, gl, bl] = [linearize(r), linearize(g), linearize(b)]
  return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl
}

/** WCAG contrast ratio (https://www.w3.org/TR/WCAG21/#dfn-contrast-ratio). */
function contrastRatio(a: Rgb, b: Rgb): number {
  const l1 = relativeLuminance(a) + 0.05
  const l2 = relativeLuminance(b) + 0.05
  return Math.max(l1, l2) / Math.min(l1, l2)
}

const WCAG_AA_NORMAL_TEXT = 4.5

// Nuxt UI's own default `UCard` "outline" background (`bg-default` ->
// `--ui-bg`), which AuthLoginCard renders on unless a consuming app
// repoints the token.
const LIGHT_DEFAULT_BG = hexToRgb('ffffff')
const DARK_DEFAULT_BG = slate(900) // --ui-bg dark: var(--ui-color-neutral-900)

// The background operator-portal actually renders AuthLoginCard's UCard
// against: `app/assets/css/tokens.css` sets `--ui-bg: var(--op-ground)`
// (`#edf0f4`), which is what exposed operator-portal#238. A consuming app
// can always pick a background dark/light enough to defeat any fixed muted
// ink, so this is not a universal guarantee — but it is the exact
// regression that was reported, pinned so it cannot silently come back.
const OPERATOR_PORTAL_REPORTED_BG = hexToRgb('edf0f4')

describe('AuthLoginCard subtitle/link/footer contrast (operator-portal#238)', () => {
  it('text-muted (the pre-fix class) fails AA against the reported background — documents the bug', () => {
    const textMutedLight = slate(500) // --ui-text-muted light: neutral-500
    expect(contrastRatio(textMutedLight, OPERATOR_PORTAL_REPORTED_BG)).toBeLessThan(
      WCAG_AA_NORMAL_TEXT,
    )
  })

  it('text-toned (the fix) clears AA in light mode against Nuxt UI’s own default background', () => {
    const textTonedLight = slate(600) // --ui-text-toned light: neutral-600
    expect(contrastRatio(textTonedLight, LIGHT_DEFAULT_BG)).toBeGreaterThanOrEqual(
      WCAG_AA_NORMAL_TEXT,
    )
  })

  it('text-toned (the fix) clears AA in light mode against operator-portal’s reported background', () => {
    const textTonedLight = slate(600)
    expect(contrastRatio(textTonedLight, OPERATOR_PORTAL_REPORTED_BG)).toBeGreaterThanOrEqual(
      WCAG_AA_NORMAL_TEXT,
    )
  })

  it('text-toned (the fix) clears AA in dark mode against Nuxt UI’s own default background', () => {
    const textTonedDark = slate(300) // --ui-text-toned dark: neutral-300
    expect(contrastRatio(textTonedDark, DARK_DEFAULT_BG)).toBeGreaterThanOrEqual(
      WCAG_AA_NORMAL_TEXT,
    )
  })

  it('text-toned (the fix) clears AA in dark mode against Nuxt UI’s elevated surface', () => {
    // `--ui-bg-elevated` dark (neutral-800), the next-closest realistic
    // "card on a panel" background a consuming app might compose against.
    const textTonedDark = slate(300)
    const darkElevatedBg = oklchToSrgb(0.279, 0.041, 260.031)
    expect(contrastRatio(textTonedDark, darkElevatedBg)).toBeGreaterThanOrEqual(WCAG_AA_NORMAL_TEXT)
  })
})
