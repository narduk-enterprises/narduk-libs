---
"@narduk-enterprises/narduk-shell": patch
---

Clear the 20 mechanical narduk-lint warnings recorded against
`@narduk-enterprises/narduk-shell` (narduk-libs#1237): `array-type` (`T[]` /
`readonly T[]` to `Array<T>` / `ReadonlyArray<T>`), `perfectionist/sort-interfaces`
and `perfectionist/sort-object-types` (alphabetized keys), `perfectionist/sort-imports`
(blank line between import groups), `unicorn/no-for-each` (`for...of` in place of
`.forEach`), `unicorn/no-useless-undefined`, `vue/define-macros-order`
(`defineEmits` moved above `defineModel`), and `consistent-type-definitions`
(`type` to `interface` for an object type literal). No behaviour change: all
fixes are type-only or control-flow-equivalent rewrites, verified by the
existing unit/mount/SSR test suites.
