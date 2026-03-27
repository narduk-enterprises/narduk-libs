import { ref, onMounted, onUnmounted, type Ref } from 'vue'

function getFsElement(): Element | null {
  return document.fullscreenElement
    ?? (document as unknown as { webkitFullscreenElement?: Element | null }).webkitFullscreenElement
    ?? null
}

async function requestFs(el: HTMLElement): Promise<void> {
  const fn = el.requestFullscreen
    ?? (el as unknown as { webkitRequestFullscreen?: () => Promise<void> }).webkitRequestFullscreen
  if (fn) await fn.call(el)
}

async function exitFs(): Promise<void> {
  const doc = document as Document & { webkitExitFullscreen?: () => Promise<void> }
  if (document.fullscreenElement && document.exitFullscreen) {
    await document.exitFullscreen()
    return
  }
  if (doc.webkitExitFullscreen) await doc.webkitExitFullscreen()
}

/**
 * Browser fullscreen for a chart panel. Bind `targetRef` to the element to expand (usually a card wrapper).
 */
export function useChartFullscreen(): {
  targetRef: Ref<HTMLElement | null>
  isFullscreen: Ref<boolean>
  enter: () => Promise<boolean>
  exit: () => Promise<void>
  toggle: () => Promise<boolean>
} {
  const targetRef = ref<HTMLElement | null>(null)
  const isFullscreen = ref(false)

  function sync() {
    const el = getFsElement()
    isFullscreen.value = el !== null && el === targetRef.value
  }

  async function enter(): Promise<boolean> {
    const el = targetRef.value
    if (!el) return false
    try {
      await requestFs(el)
      return getFsElement() === el
    } catch {
      return false
    }
  }

  async function exit(): Promise<void> {
    if (!getFsElement()) return
    try {
      await exitFs()
    } catch { /* ignore */ }
  }

  async function toggle(): Promise<boolean> {
    if (isFullscreen.value) {
      await exit()
      return !getFsElement()
    }
    return enter()
  }

  onMounted(() => {
    document.addEventListener('fullscreenchange', sync)
    document.addEventListener('webkitfullscreenchange', sync)
    sync()
  })
  onUnmounted(() => {
    document.removeEventListener('fullscreenchange', sync)
    document.removeEventListener('webkitfullscreenchange', sync)
  })

  return { targetRef, isFullscreen, enter, exit, toggle }
}
