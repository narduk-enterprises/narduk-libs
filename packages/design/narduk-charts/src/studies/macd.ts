import { ema } from './ema'

function macdLine(closes: number[], fastPeriod: number, slowPeriod: number): (number | null)[] {
  const ef = ema(closes, fastPeriod)
  const es = ema(closes, slowPeriod)
  return closes.map((_, i) => {
    const a = ef[i]
    const b = es[i]
    return a != null && b != null ? a - b : null
  })
}

/** MACD line, signal (EMA of line), histogram. Missing line samples forward-fill for signal input. */
export function macd(
  closes: number[],
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9,
): {
  line: (number | null)[]
  signal: (number | null)[]
  hist: (number | null)[]
} {
  const line = macdLine(closes, fastPeriod, slowPeriod)
  const filled: number[] = []
  let last = 0
  for (let i = 0; i < line.length; i++) {
    const v = line[i]
    if (v != null) last = v
    filled.push(last)
  }
  const signal = ema(filled, signalPeriod)
  const hist = closes.map((_, i) => {
    const l = line[i]
    const s = signal[i]
    return l != null && s != null ? l - s : null
  })
  return { line, signal, hist }
}
