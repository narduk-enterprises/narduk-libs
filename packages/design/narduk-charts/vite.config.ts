import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import dts from 'vite-plugin-dts'

export default defineConfig({
  plugins: [
    vue(),
    tailwindcss(),
    dts({
      include: ['src'],
      exclude: ['src/**/*.story.vue', 'src/**/*.test.ts', 'src/stories/**', 'src/entries/**'],
      // TypeScript 6 infers rootDir as the package root, so declarations land in
      // dist/src and the public dist/index.d.ts entry is left as `export {}`.
      compilerOptions: {
        rootDir: resolve(__dirname, 'src'),
      },
      insertTypesEntry: true,
    }),
  ],
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'NardukCharts',
      fileName: 'narduk-charts',
    },
    rollupOptions: {
      external: ['vue'],
      output: {
        globals: {
          vue: 'Vue',
        },
      },
    },
    cssCodeSplit: false,
  },
})
