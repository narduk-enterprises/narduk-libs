/**
 * Resolve any CSS colour the browser understands (named, hsl, oklch, color-mix) to a literal
 * `#hex` or `rgba()` string MapLibre can paint, by drawing one pixel on a canvas. Browser only:
 * on the server it returns the input unchanged.
 */
let swatch: CanvasRenderingContext2D | null = null

export function toLiteralColor(value: string): string {
  if (/^(?:#[\da-f]{3,8}|rgba?\()/i.test(value)) return value
  if (typeof document === 'undefined') return value
  if (!swatch) {
    const canvas = document.createElement('canvas')
    canvas.width = 1
    canvas.height = 1
    swatch = canvas.getContext('2d', { willReadFrequently: true })
  }
  if (!swatch) return value
  swatch.clearRect(0, 0, 1, 1)
  swatch.fillStyle = value
  swatch.fillRect(0, 0, 1, 1)
  const d = swatch.getImageData(0, 0, 1, 1).data
  return `rgba(${d[0]},${d[1]},${d[2]},${(d[3] as number) / 255})`
}
