import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import { appPath } from './config.js'
import type { SocialPreviewConfig } from './config.js'

export const MAX_IMAGE_BYTES = 5_000_000

export async function inspectSocialImage(bytes: Uint8Array, mime?: string): Promise<string> {
  if (bytes.byteLength === 0 || bytes.byteLength >= MAX_IMAGE_BYTES)
    throw new Error('Image must be nonempty and below 5 MB')
  const sharp = (await import('sharp')).default
  const image = sharp(bytes, { limitInputPixels: 1200 * 630, failOn: 'warning' })
  const metadata = await image.metadata()
  const mimeTypes: Record<string, string> = {
    png: 'image/png',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
  }
  const expectedMime = mimeTypes[metadata.format ?? '']
  if (!expectedMime || (mime && mime.split(';')[0]?.trim().toLowerCase() !== expectedMime)) {
    throw new Error('Image must be PNG, JPEG, or WebP with a matching Content-Type')
  }
  if (metadata.width !== 1200 || metadata.height !== 630 || (metadata.pages ?? 1) !== 1) {
    throw new Error('Image must be a single 1200x630 frame')
  }
  // Decode the complete image: a plausible header on a truncated body is not proof.
  const pixels = await image.ensureAlpha().raw().toBuffer()
  return createHash('sha256').update(pixels).digest('hex')
}

export function defaultImageFile(config: SocialPreviewConfig, root: string): string {
  return appPath(root, 'public' + config.defaultImage.path)
}

export async function generateSocialImage(
  config: SocialPreviewConfig,
  root: string,
  options: { force?: boolean; ifMissing?: boolean } = {},
): Promise<string> {
  const target = defaultImageFile(config, root)
  if (existsSync(target)) {
    if (options.ifMissing) {
      await inspectSocialImage(readFileSync(target))
      return target
    }
    if (!options.force) throw new Error('Default image already exists; use --force to replace it')
  }
  if (!config.defaultImage.source)
    throw new Error('defaultImage.source is required to generate the image')
  const sharp = (await import('sharp')).default
  const source = readFileSync(appPath(root, config.defaultImage.source))
  if (source.byteLength > MAX_IMAGE_BYTES) throw new Error('Default image source exceeds 5 MB')
  const bytes = await sharp(source, { limitInputPixels: 16_000_000 })
    .resize(1200, 630, { fit: 'cover' })
    .toFormat(
      target.toLowerCase().endsWith('.webp') ? 'webp' : /\.jpe?g$/iu.test(target) ? 'jpeg' : 'png',
    )
    .toBuffer()
  await inspectSocialImage(bytes)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, bytes, { flag: options.force ? 'w' : 'wx' })
  return target
}
