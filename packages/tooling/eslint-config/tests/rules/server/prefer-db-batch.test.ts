import { RuleTester } from 'eslint'
import { describe, it } from 'vitest'

import rule from '../../../src/rules/server/prefer-db-batch'

RuleTester.describe = describe
RuleTester.it = it

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2024, sourceType: 'module' },
})

const FILE = 'server/api/things.post.ts'
const handler = (body: string) => `export default defineEventHandler(async () => {\n${body}\n})`

ruleTester.run('prefer-db-batch', rule, {
  valid: [
    { name: 'single write', filename: FILE, code: handler('await db.insert(a).values(x)') },
    {
      name: 'already batched',
      filename: FILE,
      code: handler('await db.batch([db.insert(a).values(x), db.delete(b).where(eq(b.id, id))])'),
    },
    {
      name: 'second write depends on the first',
      filename: FILE,
      code: handler(
        'const [row] = await db.insert(a).values(x).returning()\nawait db.insert(b).values({ aId: row.id })',
      ),
    },
    {
      name: 'not consecutive',
      filename: FILE,
      code: handler(
        "await db.insert(a).values(x)\nlog.info('inserted')\nawait db.delete(b).where(eq(b.id, id))",
      ),
    },
    {
      name: 'reads are not writes',
      filename: FILE,
      code: handler('await db.select().from(a)\nawait db.select().from(b)'),
    },
    {
      name: 'transaction receiver is not flagged',
      filename: FILE,
      code: handler(
        'await db.transaction(async (tx) => {\nawait tx.insert(a).values(x)\nawait tx.insert(b).values(y)\n})',
      ),
    },
    {
      name: 'Promise.all over reads',
      filename: FILE,
      code: handler('await Promise.all(ids.map((id) => db.select().from(a).where(eq(a.id, id))))'),
    },
    {
      name: 'not server code',
      filename: 'app/utils/x.ts',
      code: 'await db.insert(a).values(x)\nawait db.insert(b).values(y)',
    },
    {
      name: 'server test tree exempt',
      filename: 'server/__tests__/seed.ts',
      code: 'await db.insert(a).values(x)\nawait db.insert(b).values(y)',
    },
  ],
  invalid: [
    {
      name: 'two consecutive writes',
      filename: FILE,
      code: handler('await db.insert(a).values(x)\nawait db.update(b).set(y).where(eq(b.id, id))'),
      errors: [{ messageId: 'consecutive', data: { count: '2' } }],
    },
    {
      name: 'three writes incl. an assignment',
      filename: FILE,
      code: handler(
        'await db.delete(a).where(eq(a.id, id))\nconst r = await db.insert(b).values(y)\nawait db.insert(c).values(z)',
      ),
      errors: [{ messageId: 'consecutive', data: { count: '3' } }],
    },
    {
      name: 'Promise.all over mapped writes',
      filename: FILE,
      code: handler('await Promise.all(rows.map((r) => db.insert(t).values(r)))'),
      errors: [{ messageId: 'mapped' }],
    },
    {
      name: 'Promise.all over mapped writes in a block body',
      filename: 'server/utils/sync.ts',
      code: 'await Promise.all(rows.map(async (r) => { await db.update(t).set(r).where(eq(t.id, r.id)) }))',
      errors: [{ messageId: 'mapped' }],
    },
    {
      name: 'custom receiver',
      filename: FILE,
      options: [{ receivers: ['database'] }],
      code: handler('await database.insert(a).values(x)\nawait database.insert(b).values(y)'),
      errors: [{ messageId: 'consecutive' }],
    },
  ],
})
