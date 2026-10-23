import { describe, expect, it } from 'vitest'

import { nodeDriverOptions } from '../src/node.js'
import { redactSecrets } from '../src/redact.js'

/** Ponytail-5 s8 repros for #2003 auth-tenancy-pg #6 and #7. */
describe('ponytail-5 s8', () => {
  it('#6 redacts the password of a DSN with no username', () => {
    expect(
      redactSecrets('connection to postgres://:hunter2@10.70.0.4:5432/db failed'),
    ).not.toContain('hunter2')
  })

  it.each(['x -c role=postgres', 'x\t-c role=postgres', 'x\n-c\rrole=postgres'])(
    '#7 keeps application name %j inside one libpq -c argument',
    (applicationName) => {
      const { options } = nodeDriverOptions({ applicationName })
      // The server splits on unescaped whitespace: only the package's own two flags may appear.
      const flags = options.split(/(?<!\\)\s/u).filter((word) => word === '-c')
      expect(flags).toHaveLength(2)
    },
  )
})
