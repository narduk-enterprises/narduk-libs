import { ref, type Ref } from 'vue'

/**
 * Rolling buffer of numeric samples for live charts (e.g. anemometer, metrics).
 * Push new readings; oldest values drop when length exceeds `maxPoints`.
 */
export function useStreamingSeries(maxPoints: number, initial: number[] = []) {
  const values: Ref<number[]> = ref(
    initial.length ? initial.slice(-maxPoints) : [],
  )

  function push(v: number) {
    const next = values.value.slice()
    next.push(v)
    while (next.length > maxPoints) next.shift()
    values.value = next
  }

  /** Replace the window (still trimmed to `maxPoints`). */
  function setWindow(next: number[]) {
    values.value = next.slice(-maxPoints)
  }

  function clear() {
    values.value = []
  }

  return { values, push, setWindow, clear }
}
