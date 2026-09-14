/**
 * useHaptics — Cross-platform haptic feedback composable.
 *
 * - Android: Uses the Vibration API (Chrome, Firefox)
 * - iOS Safari 17.4+: Uses a hidden checkbox switch trick to trigger Taptic Engine
 *
 * @example
 * ```vue
 * <script setup>
 * const { lightTap, successTap, errorTap } = useHaptics()
 * </script>
 * <template>
 *   <UButton @click="lightTap">Tap me</UButton>
 * </template>
 * ```
 */
export function useHaptics() {
  /**
   * Trigger a light haptic tap — used on key presses.
   */
  function lightTap() {
    if (import.meta.server) return
    vibrate(10)
  }

  /**
   * Trigger a medium haptic tap — used on submit/enter.
   */
  function mediumTap() {
    if (import.meta.server) return
    vibrate(20)
  }

  /**
   * Trigger an error haptic pattern — used on invalid input.
   */
  function errorTap() {
    if (import.meta.server) return
    vibrate([30, 50, 30])
  }

  /**
   * Trigger a success haptic pattern — used on winning/confirmation.
   */
  function successTap() {
    if (import.meta.server) return
    vibrate([10, 30, 10, 30, 10])
  }

  return {
    lightTap,
    mediumTap,
    errorTap,
    successTap,
  }
}

/**
 * Attempt to vibrate using the Vibration API.
 * Falls back to a Safari-specific selection trick for iOS Taptic Engine.
 */
function vibrate(pattern: number | number[]): void {
  if (import.meta.client) {
    // Standard Vibration API (Android Chrome, etc.)
    if ('vibrate' in navigator) {
      try {
        navigator.vibrate(pattern)
        return
      } catch {
        // Vibration API might be blocked; fall through to fallback
      }
    }

    // iOS Safari 17.4+ fallback: use a hidden `<input type="checkbox" switch />`
    // to invoke the system's Taptic Engine
    const fireHaptic = () => {
      try {
        const label = document.createElement('label')
        const input = document.createElement('input')
        input.type = 'checkbox'
        input.setAttribute('switch', '')
        label.appendChild(input)

        label.style.position = 'fixed'
        label.style.top = '-100px'
        label.style.left = '-100px'
        label.style.opacity = '0'
        label.style.pointerEvents = 'none'

        document.body.appendChild(label)
        label.click()

        // Clean up after a frame
        requestAnimationFrame(() => {
          label.remove()
        })
      } catch {
        // Silently fail if this trick doesn't work
      }
    }

    if (Array.isArray(pattern)) {
      let delay = 0
      for (let i = 0; i < pattern.length; i++) {
        if (i % 2 === 0) {
          // Even indices are vibrate durations
          setTimeout(fireHaptic, delay)
        }
        delay += pattern[i] ?? 0
      }
    } else {
      fireHaptic()
    }
  }
}
