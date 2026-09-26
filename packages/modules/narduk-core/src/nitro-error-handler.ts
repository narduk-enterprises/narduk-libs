/**
 * Nitro 2.13's generated wrapper imports `errorHandler` paths in array order
 * and stops only when `event.handled`. Nuxt already pushed its Vue renderer
 * before `nitro:init`; prepending our handlers mutates the error first and
 * then returns so that renderer (and the estate error.vue) still run.
 *
 * `handlerPaths` land first, in the order given, and an earlier copy of any
 * of them is dropped so the chain never runs one twice. A string
 * `errorHandler` is kept as the first entry after them.
 *
 * Lives in `src/` so the module does not import the runtime handler (that
 * file loads `nitropack/runtime`, which is only safe inside a Nitro app).
 */
export function prependNitroErrorHandlers(
  errorHandler: string | string[] | undefined,
  handlerPaths: readonly string[],
): string[] {
  const existing = Array.isArray(errorHandler) ? errorHandler : errorHandler ? [errorHandler] : []
  return [...handlerPaths, ...existing.filter((entry) => !handlerPaths.includes(entry))]
}
