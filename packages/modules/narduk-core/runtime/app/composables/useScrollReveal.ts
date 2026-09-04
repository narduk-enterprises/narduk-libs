/**
 * useScrollReveal — IntersectionObserver-based scroll reveal animation.
 *
 * Elements with class `reveal-on-scroll` get `revealed` added when visible.
 * Optional `data-delay` attribute (in 100ms units) staggers the reveal.
 *
 * @example
 * ```vue
 * <script setup>
 * useScrollReveal()
 * </script>
 * <template>
 *   <div class="reveal-on-scroll" data-delay="2">Appears after 200ms</div>
 * </template>
 * ```
 *
 * Pair with CSS:
 * ```css
 * .reveal-on-scroll { opacity: 0; transform: translateY(20px); transition: all 0.6s ease; }
 * .reveal-on-scroll.revealed { opacity: 1; transform: translateY(0); }
 * ```
 */
export function useScrollReveal() {
  if (import.meta.server) return

  // Hoisted so onUnmounted can reference the same instance that onMounted creates.
  let observer: IntersectionObserver | undefined

  onMounted(() => {
    const elements = document.querySelectorAll('.reveal-on-scroll')

    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const apply = () => entry.target.classList.add('revealed')
            const rawDelay = (entry.target as HTMLElement).dataset.delay
            // parseInt with explicit radix; guard NaN so timeout falls back to 0ms.
            const delayMs = Math.max(0, (Number.parseInt(rawDelay ?? '', 10) || 0) * 100)
            if (delayMs > 0) {
              setTimeout(apply, delayMs)
            } else {
              apply()
            }
            observer!.unobserve(entry.target)
          }
        }
      },
      { threshold: 0.1 },
    )

    for (const el of elements) {
      observer.observe(el)
    }
  })

  // Disconnect when the component that called useScrollReveal() unmounts.
  // Without this, the observer leaks across client-side navigations and keeps
  // stale references to DOM nodes that have already been removed.
  // Registered synchronously alongside onMounted (not inside it) so Vue's
  // lifecycle hook injection is guaranteed to be active.
  onUnmounted(() => observer?.disconnect())
}
