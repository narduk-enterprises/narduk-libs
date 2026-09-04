import type { ExportChartOptions } from '../types'

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/** First `svg` inside the chart root (the `.narduk-chart` element). */
export function getChartSvgElement(chartRoot: HTMLElement | null): SVGElement | null {
  if (!chartRoot) return null
  return chartRoot.querySelector('svg')
}

function prepareSvgClone(svg: SVGElement, embeddedCss?: string): SVGElement {
  const clone = svg.cloneNode(true) as SVGElement
  if (!clone.getAttribute('xmlns')) clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  if (embeddedCss?.trim()) {
    const styleEl = document.createElementNS('http://www.w3.org/2000/svg', 'style')
    styleEl.textContent = embeddedCss
    clone.insertBefore(styleEl, clone.firstChild)
  }
  return clone
}

export function serializeChartSvg(svg: SVGElement, embeddedCss?: string): string {
  const clone = prepareSvgClone(svg, embeddedCss)
  const serialized = new XMLSerializer().serializeToString(clone)
  return `<?xml version="1.0" encoding="UTF-8"?>${serialized}`
}

/**
 * Download the chart as an `.svg` file (browser only).
 */
export function exportChartSvg(
  svg: SVGElement | null,
  options?: ExportChartOptions,
): void {
  if (!svg || typeof window === 'undefined') return
  const xml = serializeChartSvg(svg, options?.embeddedCss)
  const blob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' })
  triggerDownload(blob, options?.filename ?? 'chart.svg')
}

/**
 * Rasterize the SVG to PNG (browser only). Pass `embeddedCss` with `narduk-charts` CSS
 * for fills/strokes that come from stylesheets.
 */
export function exportChartPng(
  svg: SVGElement | null,
  options?: ExportChartOptions,
): Promise<void> {
  if (!svg || typeof window === 'undefined') return Promise.resolve()

  const scale = options?.scale ?? 2
  const filename = options?.filename ?? 'chart.png'
  const xml = serializeChartSvg(svg, options?.embeddedCss)
  const blob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)

  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      try {
        const w = Number(svg.getAttribute('width')) || img.naturalWidth || 600
        const h = Number(svg.getAttribute('height')) || img.naturalHeight || 400
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(w * scale))
        canvas.height = Math.max(1, Math.round(h * scale))
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          URL.revokeObjectURL(url)
          reject(new Error('Canvas 2D context unavailable'))
          return
        }
        ctx.scale(scale, scale)
        ctx.drawImage(img, 0, 0, w, h)
        canvas.toBlob((pngBlob) => {
          URL.revokeObjectURL(url)
          if (!pngBlob) {
            reject(new Error('PNG encoding failed'))
            return
          }
          triggerDownload(pngBlob, filename)
          resolve()
        }, 'image/png')
      } catch (e) {
        URL.revokeObjectURL(url)
        reject(e)
      }
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('SVG image load failed'))
    }
    img.src = url
  })
}
