# Database-ownership fixtures

Three `Config/cloudflare-app.json` shapes the `deployment.databaseOwnership`
capability has to hold, kept as real files rather than object literals so the
declaration a reviewer reads is the declaration the tests drive.

| File                                           | Shape                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `public-no-database.json`                      | No D1 binding at all: ownership is not applicable, and nothing about it may become required.                                                                                                                                                                                                                                                                                      |
| `public-migration-owned-d1.json`               | One D1 binding, migration-owned, **no `databaseOwnership` key**. This is the compatibility case: an app that migrates everything keeps working with no config change, and the plan is byte-for-byte what it was before the capability existed.                                                                                                                                    |
| `authenticated-contract-owned-read-model.json` | Auth D1 (`DB`) migration-owned **plus** a contract-owned read model (`READ_MODEL`). Operator Portal's exact shape, and the reason the capability exists: its read model's schema is owned by a JSON contract and an hourly refresh, so the only way it could have declared `deployment.migrations` before was to manufacture a migration baseline for a database nobody migrates. |

`tests/database-ownership.test.ts` materializes a checkout around each of these
— wrangler config, migration sources, contract file, `package.json` scripts —
and then injects the defects the declaration exists to refuse.
