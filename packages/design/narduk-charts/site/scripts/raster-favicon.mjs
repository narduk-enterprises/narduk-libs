/**
 * Rasterize site/public/favicon.svg into PNG touch + favicon sizes (no AI assets).
 * Run: node site/scripts/raster-favicon.mjs
 */
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const __dirname = dirname(fileURLToPath(import.meta.url))
const publicDir = resolve(__dirname, '../public')
const src = resolve(publicDir, 'favicon.svg')

const targets = [
  { size: 180, name: 'apple-touch-icon.png' },
  { size: 32, name: 'favicon-32x32.png' },
  { size: 16, name: 'favicon-16x16.png' },
]

for (const { size, name } of targets) {
  const out = resolve(publicDir, name)
  await sharp(src).resize(size, size).png().toFile(out)
  console.warn(`wrote ${name} (${size}×${size})`)
}
