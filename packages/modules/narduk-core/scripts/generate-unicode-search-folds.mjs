// Run with the repository's pinned Node version, then format the generated JSON.
// Unicode letters/numbers that change under NFD + mark stripping + lowercasing,
// plus removed marks. Hangul's 11,172 syllables use its standard decomposition
// formula in SQL instead of inflating the lookup. Separators stay separators.
import { writeFileSync } from 'node:fs'

const folds = {}
for (let point = 128; point <= 0x10ffff; point++) {
  if (point >= 0xac00 && point <= 0xd7a3) continue
  const char = String.fromCodePoint(point)
  if (!/[\p{L}\p{N}\p{M}]/u.test(char)) continue
  const folded = char.normalize('NFD').replaceAll(/\p{M}/gu, '').toLowerCase().replaceAll('ς', 'σ')
  if (folded !== char) folds[point] = folded
}
writeFileSync(
  new URL('../runtime/server/unicode-search-folds.json', import.meta.url),
  JSON.stringify(folds) + '\n',
)
