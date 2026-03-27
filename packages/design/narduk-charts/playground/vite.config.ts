import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  root: resolve(__dirname),
  plugins: [vue(), tailwindcss()],
  resolve: {
    alias: {
      '@narduk-enterprises/narduk-charts': resolve(__dirname, '../src/index.ts'),
    },
  },
})
