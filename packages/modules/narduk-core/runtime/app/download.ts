/**
 * Save generated content as a file in the browser (seven apps hand-rolled
 * the object-URL-and-anchor dance; `NeCsvDownload` inlines it too).
 *
 * The object URL is revoked on the next task, not synchronously after
 * `click()`: some browsers start the download asynchronously and a URL
 * revoked in the same task can cancel it. On the server it does nothing and
 * returns `false`.
 *
 * Import it explicitly from `@narduk-enterprises/narduk-core/app/download`.
 */

export function downloadFile(
  filename: string,
  content: Blob | BlobPart,
  type = 'application/octet-stream',
): boolean {
  if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') return false
  const blob = content instanceof Blob ? content : new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.rel = 'noopener'
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  try {
    anchor.click()
  } finally {
    anchor.remove()
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }
  return true
}
