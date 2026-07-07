/**
 * Root directory passed to `readProvisionMetadata` for the Nuxt template dev port SSOT.
 *
 * When `nuxi` / Nuxt runs, `process.cwd()` is the consuming app project root, whether
 * this layer is linked in-tree (`layers/core`) or installed under `node_modules`.
 * Deriving the root from `import.meta.url` breaks in the published-package case because
 * it resolves inside the layer package path.
 *
 * `NUXT_ROOT_DIR` overrides for tests or non-default launch contexts.
 */
export function resolveNuxtProvisionAppRoot(): string {
  const dir = process.env.NUXT_ROOT_DIR
  return dir != null && dir !== '' ? dir : process.cwd()
}
