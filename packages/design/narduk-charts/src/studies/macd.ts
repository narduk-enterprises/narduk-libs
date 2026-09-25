import { ema } from './ema'

function macdLine(closes: number[], fastPeriod: number, slowPeriod: number): Array<number | null> {
  const ef = ema(closes, fastPeriod)
  const es = ema(closes, slowPeriod)
  return closes.map((_, i) => {
    const a = ef[i]
    const b = es[i]
    return a != null && b != null ? a - b : null
  })
}

/**
 * MACD line, signal (EMA of line), histogram. The signal starts from the
 * line's first real sample; a missing sample after that forward-fills (#867).
 */
export function macd(
  closes: number[],
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9,
): {
  line: Array<number | null>
  signal: Array<number | null>
  hist: Array<number | null>
} {
  const line = macdLine(closes, fastPeriod, slowPeriod)
  const start = line.findIndex(v => v != null)
  const signal: Array<number | null> = new Array(closes.length).fill(null)
  if (start >= 0) {
    const filled: number[] = []
    let last = line[start]!
    for (let i = start; i < line.length; i++) {
      const v = line[i]
      if (v != null) last = v
      filled.push(last)
    }
    const smoothed = ema(filled, signalPeriod)
    for (let j = 0; j < smoothed.length; j++) signal[start + j] = smoothed[j] ?? null
  }
  const hist = closes.map((_, i) => {
    const l = line[i]
    const s = signal[i]
    return l != null && s != null ? l - s : null
  })
  return { line, signal, hist }
}
