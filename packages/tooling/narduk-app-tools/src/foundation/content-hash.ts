/**
 * Whitespace-normalised content hashing for item 4.2 (spec §3: "the #76
 * Wave-1 file list, by whitespace-normalised content hash"). Normalising
 * before hashing means a file re-indented or saved with different line
 * endings still matches its known fork fingerprint -- the fork detector cares
 * about content, not formatting.
 */

import { createHash } from 'node:crypto'

/** CRLF -> LF, strip trailing whitespace per line, drop trailing blank lines
 * at EOF, and end with exactly one newline. Deterministic and stable across
 * git `core.autocrlf` settings and editors that trim-on-save differently. */
export function normalizeContent(text: string): string {
  const lines = text
    .replaceAll(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  return lines.join('\n') + '\n'
}

export function normalizedContentHash(text: string): string {
  return createHash('sha256').update(normalizeContent(text), 'utf8').digest('hex')
}
