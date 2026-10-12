import { resolve } from 'node:path'
import vue from '@vitejs/plugin-vue'
import dts from 'vite-plugin-dts'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [
    vue(),
    dts({
      include: ['src'],
      exclude: ['src/**/*.test.ts'],
      // TypeScript 6 infers rootDir as the package root; pin it so declarations land in dist/.
      compilerOptions: { rootDir: resolve(__dirname, 'src') },
    }),
  ],
  build: {
    lib: {
      entry: {
        index: resolve(__dirname, 'src/index.ts'),
        svg: resolve(__dirname, 'src/svg.ts'),
        style: resolve(__dirname, 'src/style.ts'),
        gl: resolve(__dirname, 'src/gl.ts'),
      },
      formats: ['es'],
    },
    rollupOptions: {
      // The GL library is an optional peer: never bundled, only ever dynamically imported.
      external: ['vue', 'maplibre-gl'],
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: asset =>
          asset.names.some(name => name.endsWith('.css'))
            ? 'narduk-maps.css'
            : 'assets/[name][extname]',
      },
    },
    cssCodeSplit: false,
  },
})
