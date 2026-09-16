export const packageGates = ['lint', 'typecheck', 'build', 'test:unit', 'check:package']

// One lane runs one package at a time. The weights affect scheduling only;
// unknown/new packages still run every gate, using the median-sized estimate.
export function batchPackages(matrix, weights, limit = 8) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 8)
    throw new Error('Batch limit must be 1–8.')
  if (new Set(matrix.map(({ filter }) => filter)).size !== matrix.length) {
    throw new Error('The package plan contains duplicates.')
  }
  const batches = Array.from({ length: Math.min(limit, matrix.length) }, (_, index) => ({
    label: `batch-${index + 1}`,
    filter: '',
    'extra-scripts': 'ci:batch',
    packages: [],
    estimatedSeconds: 0,
  }))
  const weight = ({ label }) => weights[label] || 30
  const ordered = [...matrix].sort(
    (a, b) => weight(b) - weight(a) || a.filter.localeCompare(b.filter),
  )
  for (const entry of ordered) {
    const batch = [...batches].sort(
      (a, b) => a.estimatedSeconds - b.estimatedSeconds || a.label.localeCompare(b.label),
    )[0]
    batch.packages.push(entry.filter)
    batch.estimatedSeconds += weight(entry)
  }
  return batches
}
