/**
 * Save generated content as a file in the browser (seven apps hand-rolled
 * the object-URL-and-anchor dance; `NeCsvDownload` inlines it too).
 *
 * The object URL is revoked a few seconds later, not synchronously after
 * `click()`: browsers start the download asynchronously, and some Safari and
 * iOS builds cancel it when the URL is revoked too soon (FileSaver.js waits
 * longer still for the same reason). On the server it does nothing and
 * returns `false`.
 *
 * Import it explicitly from `@narduk-enterprises/narduk-core/app/download`.
 */

/** How long the object URL outlives the click. */
export const REVOKE_DELAY_MS = 10_000

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
    setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS)
  }
  return true
}
