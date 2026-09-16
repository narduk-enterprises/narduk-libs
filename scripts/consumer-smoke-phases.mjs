// Expand only plain sequential pnpm script calls. Shell logic, lifecycle hooks,
// arguments and unknown forms remain intact and execute through pnpm as before.
export function qualityPhases(scripts, name = 'quality', ancestors = []) {
  if (ancestors.includes(name))
    throw new Error(`Cyclic generated script: ${[...ancestors, name].join(' -> ')}`)
  const command = scripts[name]
  if (typeof command !== 'string' || !command.trim())
    throw new Error(`Missing generated script: ${name}`)
  if (scripts[`pre${name}`] || scripts[`post${name}`]) return [name]
  const calls = command
    .split(/\s*&&\s*/u)
    .map((part) => /^pnpm run ([a-zA-Z0-9:_-]+)$/u.exec(part.trim()))
  if (calls.some((call) => !call)) return [name]
  return calls.flatMap((call) => qualityPhases(scripts, call[1], [...ancestors, name]))
}

// Release smoke proves packed-package compatibility. Scaffold style, dead-code
// and starter-unit checks stay in the generated app's normal quality command;
// repeating them here cost 33.4s in CI run 35144180293. Keep unknown future
// phases, so a new correctness check does not silently disappear from smoke.
export function consumerSmokePhases(scripts) {
  const scaffoldOnly = new Set(['format:check', 'lint', 'knip', 'test:unit'])
  return qualityPhases(scripts).filter((phase) => !scaffoldOnly.has(phase))
}

// No more than two package tools at once; retain input-order results, and wait
// for in-flight work to finish before the caller can clean up its temp files.
export async function mapPackages(items, operation, limit = 2) {
  let next = 0
  let failure
  const results = new Array(items.length)
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (!failure && next < items.length) {
        const index = next++
        try {
          results[index] = await operation(items[index], index)
        } catch (error) {
          failure ||= error
        }
      }
    }),
  )
  if (failure) throw failure
  return results
}
