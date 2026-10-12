import { resolve } from 'node:path'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

// The design lab: real public data (MARC counties, Aquidneck towns and actions) drawn by both
// engines, for screenshots. `pnpm run lab`.
export default defineConfig({
  plugins: [vue()],
  root: resolve(__dirname, 'lab'),
  server: { port: 5183, strictPort: true },
  resolve: { alias: { '@': resolve(__dirname, 'src') } },
})
