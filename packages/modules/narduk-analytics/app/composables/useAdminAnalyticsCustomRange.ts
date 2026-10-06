import { computed, reactive, ref } from '#imports'

import { adminValidateCustomRange } from '../utils/analyticsAdminRange'

import type { AdminRangeState } from '../utils/analyticsAdminRange'

/**
 * The custom-range draft: only an applied, valid range changes what is read, so
 * typing a date never fires a request and a bad one never reaches the server.
 */
export function useAdminAnalyticsCustomRange(
  range: AdminRangeState,
  now: () => number,
  zone: () => string,
) {
  const open = ref(false)
  const draft = reactive({ end: '', start: '' })

  const check = () => adminValidateCustomRange(draft.start, draft.end, now(), zone())
  const error = computed(() => (draft.start || draft.end ? check() : null))
  const ready = computed(() => Boolean(draft.start && draft.end) && check() === null)

  function openCustom() {
    draft.start = range.start
    draft.end = range.end
    open.value = true
  }
  function applyCustom() {
    if (!ready.value) return
    range.start = draft.start
    range.end = draft.end
    range.preset = 'custom'
    open.value = false
  }
  function cancelCustom() {
    open.value = false
  }
  function choosePreset(preset: AdminRangeState['preset']) {
    if (preset === 'custom') return openCustom()
    open.value = false
    range.preset = preset
  }

  return {
    applyCustom,
    cancelCustom,
    choosePreset,
    customDraft: draft,
    customError: error,
    customOpen: open,
    customReady: ready,
    openCustom,
  }
}
