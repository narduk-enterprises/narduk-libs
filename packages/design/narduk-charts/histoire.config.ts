import { defineConfig } from 'histoire'
import { HstVue } from '@histoire/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'

export default defineConfig({
  plugins: [HstVue()],
  setupFile: resolve(__dirname, 'histoire.setup.ts'),
  theme: { title: 'NardukCharts' },
  vite: {
    plugins: [tailwindcss()],
    resolve: {
      alias: {
        '@narduk-enterprises/narduk-charts': resolve(__dirname, 'src/index.ts'),
      },
    },
  },
})
