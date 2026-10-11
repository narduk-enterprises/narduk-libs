import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

// The design lab: real public data (CDC NWSS, Kansas City) drawn by every look, for
// before/after screenshots. `pnpm exec vite --config vite.lab.config.ts`.
export default defineConfig({
  plugins: [vue(), tailwindcss()],
  root: resolve(__dirname, 'lab'),
  server: { port: 5181, strictPort: true },
  resolve: { alias: { '@': resolve(__dirname, 'src') } },
})
