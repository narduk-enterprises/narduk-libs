import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { compileScript, parse } from 'vue/compiler-sfc'
import { defineConfig, type Plugin } from 'vitest/config'

const packageRoot = dirname(fileURLToPath(import.meta.url))

/**
 * Minimal SFC compile for this package's component tests. narduk-core does
 * not declare `@vitejs/plugin-vue` (no new dependencies, narduk-libs#529);
 * `vue/compiler-sfc` already ships with `vue`.
 */
function vueSfcPlugin(): Plugin {
  return {
    name: 'narduk-core-vue-sfc',
    enforce: 'pre',
    transform(code, id) {
      const filename = id.split('?')[0] ?? id
      if (!filename.endsWith('.vue') || id.includes('?')) return null

      const { descriptor, errors } = parse(code, { filename })
      if (errors.length > 0) {
        throw new Error(errors.map((error) => error.message).join('\n'))
      }

      const script = compileScript(descriptor, {
        id: filename,
        inlineTemplate: true,
      })

      let output = script.content
      const css = descriptor.styles.map((style) => style.content).join('\n')
      if (css.length > 0) {
        const styleId = `vue-sfc-style-${filename.replaceAll(/[^a-zA-Z0-9_-]/g, '_')}`
        output += `\nif (typeof document !== 'undefined') {\n  const styleId = ${JSON.stringify(styleId)}\n  if (!document.getElementById(styleId)) {\n    const el = document.createElement('style')\n    el.id = styleId\n    el.textContent = ${JSON.stringify(css)}\n    document.head.appendChild(el)\n  }\n}\n`
      }

      return { code: output, map: script.map }
    },
  }
}

export default defineConfig({
  plugins: [vueSfcPlugin()],
  root: packageRoot,
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
  },
})
