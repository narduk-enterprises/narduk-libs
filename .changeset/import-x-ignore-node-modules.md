---
'@narduk-enterprises/eslint-config': patch
'@narduk-enterprises/narduk-core': patch
'@narduk-enterprises/create-narduk-app': patch
---

The shared `narduk/imports` block sets `import-x/ignore: ['node_modules']`, so `import-x/no-cycle`, `named`, `default` and `export` no longer parse installed packages' sources and type trees. In narduk-core that walk held about 3.4 GB of heap: peak RSS falls from 5.2 GB to 1.8 GB, lint time from about 85 s to 28 s, and the messages are identical. A cycle cannot run through an installed package, and TypeScript already checks named and default imports from one (#789). narduk-core's `lint` script drops its 4096 MB heap stopgap and runs under the repo's 3072 MB default again.
