import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  root: resolve(__dirname, 'e2e'),
  server: { port: 5180, strictPort: true },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
})
