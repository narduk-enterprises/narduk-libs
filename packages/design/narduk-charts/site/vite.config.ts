import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

const repoRoot = resolve(__dirname, '..')

export default defineConfig({
  root: __dirname,
  plugins: [vue(), tailwindcss()],
  resolve: {
    alias: {
      'narduk-charts': resolve(repoRoot, 'src/index.ts'),
    },
  },
  server: {
    port: 5173,
    strictPort: false,
  },
})
