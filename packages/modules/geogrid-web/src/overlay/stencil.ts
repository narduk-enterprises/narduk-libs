import type { CoastlineStencilDescriptor } from '../core/decode/temporal.js'
import type { GridBBox } from '../core/models.js'

export interface LoadedCoastlineStencil {
  image: HTMLCanvasElement
  bbox: GridBBox
}

/**
 * Load a grayscale ocean-coverage stencil and convert it to an alpha mask
 * (white ocean → opaque, black land → transparent).
 */
export async function loadCoastlineStencil(
  descriptor: CoastlineStencilDescriptor,
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<LoadedCoastlineStencil> {
  const url = new URL(descriptor.url, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).toString()
  const response = await fetchImpl(url)
  if (!response.ok) throw new Error(`Coastline stencil request failed with ${response.status}`)
  const bitmap = await createImageBitmap(await response.blob())
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas2D context unavailable for stencil')
  context.drawImage(bitmap, 0, 0)
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height)
  for (let index = 0; index < pixels.data.length; index += 4) {
    const coverage = pixels.data[index] ?? 0
    pixels.data[index] = 255
    pixels.data[index + 1] = 255
    pixels.data[index + 2] = 255
    pixels.data[index + 3] = coverage
  }
  context.putImageData(pixels, 0, 0)
  return { image: canvas, bbox: descriptor.bbox }
}
