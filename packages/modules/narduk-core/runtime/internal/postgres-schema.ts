/**
 * Default target of the `#narduk-core/postgres-schema` alias: the schema core
 * and auth tables live in. The module points the alias at a generated file when
 * `nardukCore.postgresSchema` names another schema (narduk-libs#1953).
 */
export const postgresSchema: string = 'public'
