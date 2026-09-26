/**
 * Native share with a clipboard fallback and a cancel-aware outcome
 * (narduk-libs#994).
 *
 * Apps offer the share sheet (`navigator.share`) where it exists and copy to
 * the clipboard where it does not. Five hand-rolled copies had four policies:
 * one copied after the user cancelled the sheet (overwriting their clipboard),
 * one never fell back, one reported failure instead of falling back. This is
 * the one policy:
 *
 * - Share when `navigator.share` exists and `navigator.canShare(data)` (when
 *   present) accepts the data.
 * - A user dismissing the sheet (`AbortError`) is `'cancelled'`: never a
 *   failure, and never followed by a clipboard write.
 * - Any other share failure (`NotAllowedError` after losing transient
 *   activation, a `TypeError` for unshareable data) falls back to the
 *   clipboard.
 * - A clipboard refusal is `'failed'`, so the caller can say "select it by
 *   hand".
 *
 * It takes no toast or UI dependency; the caller maps the outcome to its own
 * words. On the server every call answers `'failed'`.
 *
 * Import it explicitly from `@narduk-enterprises/narduk-core/app/share`. It is
 * not under `app/composables` or `app/utils`, so it adds no auto-imported
 * names to consuming apps.
 */

import { getCurrentInstance, getCurrentScope, onMounted, onScopeDispose, readonly, ref } from 'vue'

import type { Ref } from 'vue'

/** What a share attempt ended as. */
export type ShareOutcome = 'cancelled' | 'copied' | 'failed' | 'shared'

/** What a copy attempt ended as. */
export type CopyOutcome = 'copied' | 'failed'

/** The subset of the Web Share data this handles. */
export interface ShareContent {
  text?: string
  title?: string
  url?: string
}

export interface ShareAttemptOptions {
  /**
   * What to copy when the share sheet is unavailable or fails for a reason
   * other than a cancel: `'url'` (the default) copies the URL, or the text when
   * there is no URL; `'text+url'` copies the text and the URL separated by a
   * space; `false` never copies and answers `'failed'`.
   */
  fallback?: 'text+url' | 'url' | false
}

/** The navigator members this uses, so tests can pass a double. */
export interface ShareNavigator {
  canShare?: (data?: ShareContent) => boolean
  clipboard?: { writeText: (text: string) => Promise<void> }
  share?: (data?: ShareContent) => Promise<void>
}

export interface Sharer {
  /** Whether the share sheet exists at all. */
  canNativeShare: () => boolean
  copy: (text: string) => Promise<CopyOutcome>
  share: (content: ShareContent, options?: ShareAttemptOptions) => Promise<ShareOutcome>
}

function defaultNavigator(): ShareNavigator | undefined {
  return typeof navigator === 'undefined' ? undefined : (navigator as ShareNavigator)
}

function isAbort(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === 'AbortError'
  )
}

function fallbackText(
  content: ShareContent,
  fallback: ShareAttemptOptions['fallback'],
): string | undefined {
  if (fallback === false) return undefined
  if (fallback === 'text+url') {
    const joined = [content.text, content.url].filter(Boolean).join(' ')
    return joined || undefined
  }
  return content.url || content.text || undefined
}

/**
 * The Vue-free half of {@link useShare}. `getNavigator` is for tests; it
 * defaults to the global `navigator` (none on the server).
 */
export function createSharer(
  getNavigator: () => ShareNavigator | undefined = defaultNavigator,
): Sharer {
  const copy = async (text: string): Promise<CopyOutcome> => {
    const nav = getNavigator()
    if (!nav?.clipboard || !text) return 'failed'
    try {
      await nav.clipboard.writeText(text)
      return 'copied'
    } catch {
      return 'failed'
    }
  }

  const canNativeShare = () => typeof getNavigator()?.share === 'function'

  const share = async (
    content: ShareContent,
    options: ShareAttemptOptions = {},
  ): Promise<ShareOutcome> => {
    const nav = getNavigator()
    if (!nav) return 'failed'

    const data: ShareContent = { ...content }
    let accepted = typeof nav.share === 'function'
    if (accepted && typeof nav.canShare === 'function') {
      try {
        accepted = nav.canShare(data)
      } catch {
        accepted = false
      }
    }

    if (accepted) {
      try {
        // Called as a method: a detached `navigator.share` throws `TypeError`.
        await nav.share!(data)
        return 'shared'
      } catch (error) {
        if (isAbort(error)) return 'cancelled'
      }
    }

    const text = fallbackText(content, options.fallback ?? 'url')
    if (text === undefined) return 'failed'
    return copy(text)
  }

  return { canNativeShare, copy, share }
}

export interface UseShareOptions {
  /** How long `copied` stays true after a successful copy, in ms. Defaults to 2000. */
  copiedFor?: number
}

export interface UseShare {
  /** `false` on the server and first paint; whether the share sheet exists, after mount. */
  canNativeShare: Readonly<Ref<boolean>>
  copied: Readonly<Ref<boolean>>
  copy: (text: string) => Promise<CopyOutcome>
  share: (content: ShareContent, options?: ShareAttemptOptions) => Promise<ShareOutcome>
}

/**
 * Share with a clipboard fallback from a component. `copied` is true for
 * `copiedFor` ms after any successful copy, including a share that fell back
 * to one. `canNativeShare` is resolved after mount so the server and first
 * paint agree.
 */
export function useShare(
  options: UseShareOptions = {},
  getNavigator: () => ShareNavigator | undefined = defaultNavigator,
): UseShare {
  const sharer = createSharer(getNavigator)
  const copied = ref(false)
  const canNativeShare = ref(false)
  let timer: ReturnType<typeof setTimeout> | undefined

  const flagCopied = () => {
    if (timer !== undefined) clearTimeout(timer)
    copied.value = true
    timer = setTimeout(() => {
      copied.value = false
      timer = undefined
    }, options.copiedFor ?? 2000)
  }

  if (getCurrentInstance()) {
    onMounted(() => {
      canNativeShare.value = sharer.canNativeShare()
    })
  }
  if (getCurrentScope()) {
    onScopeDispose(() => {
      if (timer !== undefined) clearTimeout(timer)
    })
  }

  return {
    canNativeShare: readonly(canNativeShare),
    copied: readonly(copied),
    async copy(text) {
      const outcome = await sharer.copy(text)
      if (outcome === 'copied') flagCopied()
      return outcome
    },
    async share(content, attempt) {
      const outcome = await sharer.share(content, attempt)
      if (outcome === 'copied') flagCopied()
      return outcome
    },
  }
}
