import { execFile } from 'node:child_process'

// Preserve output for the strict warning check while exposing progress before
// a long build exits (or a runner is lost and its buffered log disappears).
export function runConsumerCommand(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = execFile(
      command,
      args,
      {
        cwd: options.cwd,
        env: options.env,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error) reject(error)
        else resolve(`${stdout}${stderr}`)
      },
    )
    child.stdout.on('data', options.stdout ?? ((chunk) => process.stdout.write(chunk)))
    child.stderr.on('data', options.stderr ?? ((chunk) => process.stderr.write(chunk)))
  })
}
