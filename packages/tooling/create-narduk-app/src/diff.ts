/**
 * A minimal unified-diff renderer for `create-narduk-app upgrade`'s dry run.
 *
 * Hand-rolled rather than taken from a package on purpose: this generator ships
 * with zero runtime dependencies so that a scaffolded app's install graph stays
 * exactly the estate's own pins, and adding one for a few hundred lines of
 * dry-run output would put a transitive dependency into every generated app's
 * lockfile. The output is display only -- drift itself is decided by exact
 * string equality, and `--write` writes the desired contents verbatim.
 */

function splitLines(value: string): string[] {
  // An absent or emptied file has no lines, not one blank one: a created file
  // renders as additions only (`@@ -0,0 +1,N @@`), an emptied one as removals.
  if (value === '') return []
  const lines = value.split('\n')
  // A trailing newline yields a final empty element; drop it so an unchanged
  // file renders no phantom context line.
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop()
  return lines
}

/** Longest-common-subsequence lengths for the two line arrays. */
function lcsTable(left: readonly string[], right: readonly string[]): Uint32Array {
  const width = right.length + 1
  const table = new Uint32Array((left.length + 1) * width)
  for (let row = left.length - 1; row >= 0; row -= 1) {
    for (let column = right.length - 1; column >= 0; column -= 1) {
      table[row * width + column] =
        left[row] === right[column]
          ? table[(row + 1) * width + column + 1] + 1
          : Math.max(table[(row + 1) * width + column], table[row * width + column + 1])
    }
  }
  return table
}

interface DiffOperation {
  kind: ' ' | '-' | '+'
  line: string
}

function diffOperations(left: readonly string[], right: readonly string[]): DiffOperation[] {
  const width = right.length + 1
  const table = lcsTable(left, right)
  const operations: DiffOperation[] = []
  let row = 0
  let column = 0
  while (row < left.length && column < right.length) {
    if (left[row] === right[column]) {
      operations.push({ kind: ' ', line: left[row] as string })
      row += 1
      column += 1
    } else if (table[(row + 1) * width + column] >= table[row * width + column + 1]) {
      operations.push({ kind: '-', line: left[row] as string })
      row += 1
    } else {
      operations.push({ kind: '+', line: right[column] as string })
      column += 1
    }
  }
  for (; row < left.length; row += 1) operations.push({ kind: '-', line: left[row] as string })
  for (; column < right.length; column += 1) {
    operations.push({ kind: '+', line: right[column] as string })
  }
  return operations
}

/**
 * Renders a unified diff, or an empty string when the two texts are identical.
 *
 * @param path - Path used in the `---`/`+++` headers.
 * @param before - Current contents.
 * @param after - Contents the generator would write.
 * @param context - Context lines around each hunk.
 */
export function unifiedDiff(path: string, before: string, after: string, context = 3): string {
  if (before === after) return ''
  const left = splitLines(before)
  const right = splitLines(after)
  const operations = diffOperations(left, right)

  const changed = operations.map((operation) => operation.kind !== ' ')
  const keep = operations.map((_, index) =>
    changed.slice(Math.max(0, index - context), index + context + 1).some(Boolean),
  )

  const lines: string[] = ['--- a/' + path, '+++ b/' + path]
  let leftLine = 1
  let rightLine = 1
  let index = 0
  while (index < operations.length) {
    if (!keep[index]) {
      const operation = operations[index] as DiffOperation
      if (operation.kind !== '+') leftLine += 1
      if (operation.kind !== '-') rightLine += 1
      index += 1
      continue
    }
    const hunkLeftStart = leftLine
    const hunkRightStart = rightLine
    const body: string[] = []
    let leftCount = 0
    let rightCount = 0
    while (index < operations.length && keep[index]) {
      const operation = operations[index] as DiffOperation
      body.push(operation.kind + operation.line)
      if (operation.kind !== '+') {
        leftLine += 1
        leftCount += 1
      }
      if (operation.kind !== '-') {
        rightLine += 1
        rightCount += 1
      }
      index += 1
    }
    lines.push(
      '@@ -' +
        (leftCount === 0 ? hunkLeftStart - 1 : hunkLeftStart) +
        ',' +
        leftCount +
        ' +' +
        (rightCount === 0 ? hunkRightStart - 1 : hunkRightStart) +
        ',' +
        rightCount +
        ' @@',
      ...body,
    )
  }
  return lines.join('\n') + '\n'
}
