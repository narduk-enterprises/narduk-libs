import { existsSync, readFileSync, realpathSync, readdirSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'

import { z } from 'zod'

const localPath = z
  .string()
  .min(1)
  .max(500)
  .refine(
    (value) => !isAbsolute(value) && !value.split(/[\\/]/u).includes('..') && !value.includes('\\'),
    'Expected a relative path inside the app',
  )
const routePath = z
  .string()
  .min(1)
  .max(2000)
  .refine(
    (value) => value.startsWith('/') && !value.startsWith('//') && !/[#\\\s]/u.test(value),
    'Expected a concrete app path, without a fragment',
  )
const samples = z.array(routePath).min(1).max(10)
const route = z.discriminatedUnion('kind', [
  z
    .object({
      source: localPath.nullable(),
      kind: z.literal('default'),
      paths: samples,
      reason: z.string().trim().min(1).optional(),
    })
    .strict(),
  z
    .object({
      source: localPath.nullable(),
      kind: z.literal('dynamic'),
      paths: samples,
      reason: z.string().trim().min(1).optional(),
    })
    .strict(),
  z
    .object({
      source: localPath.nullable(),
      kind: z.literal('private'),
      reason: z.string().trim().min(1),
    })
    .strict(),
])

export const socialPreviewSchema = z
  .object({
    schemaVersion: z.literal(1),
    siteUrl: z.string().url(),
    defaultImage: z
      .object({
        path: routePath.refine(
          (path) => /^\/(?!.*\.\.)[^?#]+\.(?:png|jpe?g|webp)$/iu.test(path),
          'Expected a public PNG, JPEG, or WebP path',
        ),
        alt: z.string().trim().min(1).max(420),
        source: localPath.optional(),
      })
      .strict(),
    pagesDir: localPath.nullable().default('app/pages'),
    inventoryNote: z.string().trim().min(1).optional(),
    imageOrigins: z.array(z.string().url()).max(10).default([]),
    routes: z.array(route).min(1).max(500),
  })
  .strict()
  .superRefine((config, ctx) => {
    if (config.pagesDir === null && !config.inventoryNote) {
      ctx.addIssue({
        code: 'custom',
        message:
          'Non-file routers require inventoryNote describing how route coverage is maintained',
      })
    }
    for (const route of config.routes) {
      if (route.source === null && !route.reason)
        ctx.addIssue({
          code: 'custom',
          message: 'Routes without a page file require a reason identifying their owner',
        })
      if (route.kind === 'dynamic' && route.source?.includes('[') && route.paths.length < 2)
        ctx.addIssue({
          code: 'custom',
          message: 'Parameterized dynamic routes require at least two examples',
        })
    }
  })

export type SocialPreviewConfig = z.infer<typeof socialPreviewSchema>

/** Config is app-owned; never follow file symlinks outside its checkout. */
export function appPath(root: string, path: string): string {
  const target = resolve(root, path)
  const rel = relative(root, target)
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('Path escapes the app')
  let ancestor = target
  while (!existsSync(ancestor)) ancestor = resolve(ancestor, '..')
  const realRel = relative(realpathSync(root), realpathSync(ancestor))
  if (realRel.startsWith('..') || isAbsolute(realRel)) throw new Error('Symlink escapes the app')
  return target
}

export function readSocialPreviewConfig(root: string, configFile: string): SocialPreviewConfig {
  const path = appPath(root, configFile)
  const config = socialPreviewSchema.parse(JSON.parse(readFileSync(path, 'utf8')))
  const site = publicUrl(config.siteUrl, true)
  if (site.pathname !== '/' || site.search) throw new Error('siteUrl must be an origin')
  for (const origin of config.imageOrigins) {
    if (publicUrl(origin).origin !== origin)
      throw new Error('imageOrigins entries must be origins without a trailing slash')
  }
  return config
}

export function publicUrl(value: string, allowLoopback = false): URL {
  const url = new URL(value)
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (
    url.username ||
    url.password ||
    url.hash ||
    (url.protocol !== 'https:' && !(allowLoopback && loopback && url.protocol === 'http:'))
  ) {
    throw new Error(
      'Social preview URLs require HTTPS without credentials or fragments (HTTP loopback is allowed only for local probes)',
    )
  }
  return url
}

function pageFiles(root: string, prefix = ''): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = prefix + entry.name
    if (entry.isSymbolicLink()) throw new Error(`Page inventory does not follow symlinks: ${path}`)
    if (entry.isDirectory()) return pageFiles(join(root, entry.name), path + '/')
    return entry.isFile() && entry.name.endsWith('.vue') ? [path] : []
  })
}

export function checkRouteInventory(config: SocialPreviewConfig, root: string): string[] {
  const errors: string[] = []
  const sources = new Set<string>()
  const paths = new Set<string>()
  for (const route of config.routes) {
    if (route.source !== null) {
      if (sources.has(route.source)) errors.push(`Duplicate route source: ${route.source}`)
      sources.add(route.source)
    }
    if (route.kind === 'private') continue
    if (route.kind === 'default' && route.source?.includes('[') && !route.reason) {
      errors.push(
        `Parameterized route ${route.source} needs dynamic previews or a reason for a generic preview`,
      )
    }
    for (const path of route.paths) {
      const resolved = new URL(path, config.siteUrl)
      if (resolved.origin !== new URL(config.siteUrl).origin)
        errors.push(`Route escapes site origin: ${route.source}`)
      if (paths.has(path)) errors.push(`Duplicate route sample: ${path}`)
      paths.add(path)
    }
  }
  if (!paths.has('/'))
    errors.push('Include the public landing page / as a default or dynamic route')
  if (config.pagesDir !== null) {
    const discovered = new Set(pageFiles(appPath(root, config.pagesDir)))
    for (const source of discovered)
      if (!sources.has(source)) errors.push(`Unclassified page: ${source}`)
    for (const source of sources)
      if (!discovered.has(source)) errors.push(`Stale route source: ${source}`)
  }
  return errors
}
