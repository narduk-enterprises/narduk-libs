---
'@narduk-enterprises/create-narduk-app': patch
---

Generate the committed `.npmrc` auth line in the plain `${GH_PACKAGES_READ}`
interpolation form.

npm does not implement `${VAR-default}` substitution: it leaves the whole
reference unsubstituted and sends the literal string as the token, so the
generated `${GH_PACKAGES_READ-UNCONFIGURED}` line returned
`401 ... cannot be authenticated with the token provided` even when the variable
was set correctly. pnpm does implement the default form, which is how the shape
passed review twice -- the estate tests on pnpm. A committed file has to work
under whichever client runs it, so the plain form is the only correct one. The
generator test pinned the broken string, asserting the defect rather than
catching it; it now pins the plain form.

Closes #93.
