---
'@narduk-enterprises/narduk-testkit': patch
'@narduk-enterprises/create-narduk-app': patch
---

Stop the `playwright-dev-port` suite asserting a hash property the dev-port
derivation never had. Four worktree paths into a 1000-port span collide at the
birthday rate (0.599%), which is the rate the old single-sample test failed at —
it blocked the narduk-core 2.6.3 release on 2026-09-19. The suite now asserts
what the implementation actually promises: derived ports spread widely enough
that lanes are practically unable to collide, and a residual collision stays
loud rather than silently attaching to another lane's dev server. Test-only;
`resolveLocalDevPort` behaviour is unchanged. `create-narduk-app` moves only
because it pins the testkit version it generates against.
