#!/usr/bin/env node
/**
 * Post-build ESM import rewrite.
 *
 * `tsc` with `module: "ESNext"` + `moduleResolution: "bundler"` emits the
 * source's relative imports as-is — so `import './env-catalog'` stays
 * extensionless. That's fine for bundlers, but Node's ESM loader rejects it:
 *   ERR_MODULE_NOT_FOUND ... '/dist/env-catalog'
 *
 * This script walks the emitted JS + .d.ts files and appends `.js` (or `.d.ts`)
 * to every relative `from '.'` / `from '..'` import specifier that doesn't
 * already have an extension. Keeps the source TypeScript readable (no
 * NodeNext-style `.js` suffixes on `.ts` imports) while producing node-ESM
 * compliant output.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const distDir = resolve(here, '..', 'dist')

const JS_SPEC_RE = /(from\s*['"])(\.\.?\/[^'"]+)(['"])/g
const DYN_IMPORT_RE = /(import\(\s*['"])(\.\.?\/[^'"]+)(['"]\s*\))/g

function rewriteSpec(extension, original) {
  if (/\.(?:m?js|c?js|json|d\.ts|d\.mts|d\.cts)$/.test(original)) return original
  return `${original}${extension}`
}

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      walk(full)
      continue
    }
    const ext = entry.endsWith('.d.ts') ? '.d.ts' : entry.endsWith('.js') ? '.js' : null
    if (!ext) continue
    const targetExt = ext === '.d.ts' ? '.js' : '.js'
    const src = readFileSync(full, 'utf8')
    const next = src
      .replace(JS_SPEC_RE, (_m, a, spec, c) => `${a}${rewriteSpec(targetExt, spec)}${c}`)
      .replace(DYN_IMPORT_RE, (_m, a, spec, c) => `${a}${rewriteSpec(targetExt, spec)}${c}`)
    if (next !== src) writeFileSync(full, next)
  }
}

walk(distDir)
