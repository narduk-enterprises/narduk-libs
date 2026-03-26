import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

function entryConfig(name: 'line' | 'bar' | 'pie' | 'candle' | 'studies') {
  return defineConfig({
    plugins: [vue(), tailwindcss()],
    build: {
      emptyOutDir: false,
      lib: {
        entry: resolve(__dirname, `src/entries/${name}.ts`),
        name: `NardukCharts${name}`,
        formats: ['es'],
        fileName: () => `${name}.js`,
      },
      rollupOptions: {
        external: ['vue'],
        output: {
          inlineDynamicImports: true,
          assetFileNames: 'entry-[name][extname]',
        },
      },
      cssCodeSplit: false,
    },
  })
}

const target = process.env.NC_ENTRY as 'line' | 'bar' | 'pie' | 'candle' | 'studies' | undefined
if (!target || !['line', 'bar', 'pie', 'candle', 'studies'].includes(target)) {
  throw new Error('Set NC_ENTRY=line|bar|pie|candle|studies when using vite.entries.config.ts')
}

export default entryConfig(target)
