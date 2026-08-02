---
'@narduk-enterprises/eslint-config': patch
---

Gate the Tailwind theme override on the `design-system` capability pack, not on
the entry file alone.

`createAppLintConfig` attached the `better-tailwindcss/*` theme rules whenever
the Tailwind entry file existed on disk, but only the `design-system` pack
registers the `better-tailwindcss` plugin. ESLint does not degrade when an
enabled rule's plugin is missing — it throws
`Could not find plugin "better-tailwindcss" in configuration` while normalising
the config and lints nothing, so any app that selected no `design-system` while
keeping its stylesheet at the conventional `app/assets/css/main.css` crashed out
of the box. Found by the first consumer migration.

The override now requires the pack (`'designSystem'` resolves too) **and** the
entry file. No pack means no override, whatever is on disk. Passing
`tailwindEntryPoint` without the pack is the one contradiction the app has to
resolve, and now throws a named configuration error at compose time instead of
dying inside ESLint's plugin resolution.
