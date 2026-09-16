import assert from 'node:assert/strict'
import test from 'node:test'
import { runConsumerCommand } from './consumer-smoke-command.mjs'

test('streams progress before completion and retains both streams for warning checks', async () => {
  const chunks = []
  let completed = false
  const output = await runConsumerCommand(
    process.execPath,
    ['-e', 'console.log("building"); setTimeout(() => console.error("WARN fixture"), 50)'],
    {
      stdout: (chunk) => {
        assert.equal(completed, false)
        chunks.push(chunk)
      },
      stderr: (chunk) => chunks.push(chunk),
    },
  ).then((value) => {
    completed = true
    return value
  })
  assert.equal(chunks.join(''), 'building\nWARN fixture\n')
  assert.equal(output, 'building\nWARN fixture\n')
})

test('a failed command keeps its exit code and exposes its output', async () => {
  const chunks = []
  await assert.rejects(
    runConsumerCommand(process.execPath, ['-e', 'console.error("build failed"); process.exit(7)'], {
      stderr: (chunk) => chunks.push(chunk),
    }),
    { code: 7 },
  )
  assert.equal(chunks.join(''), 'build failed\n')
})
