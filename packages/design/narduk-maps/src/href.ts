/** Only http(s), mailto and relative links reach an `href`; `javascript:` and `data:` are dropped. */
export function safeHref(href: string | undefined): string | undefined {
  if (!href) return undefined
  // Browsers ignore tabs and newlines inside a scheme, so test the link without them.
  const flat = href.replaceAll(/[\t\n\r]/g, '').trim()
  // Anything else with a colon before the first / ? # is some other scheme.
  return /^(?:https?|mailto):/i.test(flat) || !/^[^#/?]*:/.test(flat) ? href : undefined
}
