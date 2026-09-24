/**
 * Global component names a module asked `LayerAppFooter` to render below its
 * own content, read from `appConfig.nardukCore.footer.after`. A module adds
 * one by registering the component globally and appending its name, so it can
 * extend the footer without shipping a copy of it (narduk-libs#743).
 *
 * Anything that is not a non-empty string is dropped, and a name listed twice
 * renders once, so two layers merging the same default cannot double a row.
 */
export function footerAfterComponents(appConfig: unknown): string[] {
  const after = (appConfig as { nardukCore?: { footer?: { after?: unknown } } } | undefined)
    ?.nardukCore?.footer?.after
  if (!Array.isArray(after)) return []
  const names = after.filter((name): name is string => typeof name === 'string' && name !== '')
  return [...new Set(names)]
}
