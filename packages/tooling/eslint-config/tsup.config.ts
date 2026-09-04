import { readFileSync } from 'node:fs'

import { defineConfig } from 'tsup'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string
}

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  splitting: false,
  sourcemap: true,
  target: 'node22',
  outDir: 'dist',
  define: {
    __PKG_VERSION__: JSON.stringify(pkg.version),
  },
})
