/**
 * `import.meta.glob` is a Vite compile-time helper. The suite does not depend
 * on `vite` directly — the same exact Vue-test pins as item 9 (#272) — so
 * `vite/client` is not on the type path. This is the one method the design-card
 * tests need.
 */
interface ImportMeta {
  glob<T>(pattern: string, options?: { eager?: boolean }): Record<string, T>
}
