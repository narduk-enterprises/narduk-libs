/** Prefer dynamic `/_og/...` over static `/og.png` when duplicate og:image metas exist. */
export function pickOgImageContentFromHtml(html: string): string | null {
  const metas = html.matchAll(/<meta\b[^>]*>/gi)
  const contents: string[] = []
  for (const m of metas) {
    const tag = m[0]
    if (!/\b(?:property|name)=["']og:image["']/i.test(tag)) continue
    const withDouble = tag.match(/\bcontent="([^"]*)"/i)
    const withSingle = tag.match(/\bcontent='([^']*)'/i)
    const raw = withDouble?.[1] ?? withSingle?.[1]
    if (raw !== undefined && raw !== '') contents.push(raw)
  }
  if (contents.length === 0) return null
  const dynamic = contents.find((c) => c.includes('/_og/'))
  return dynamic ?? contents[0] ?? null
}
