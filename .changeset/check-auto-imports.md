---
'@narduk-enterprises/narduk-app-tools': minor
'@narduk-enterprises/create-narduk-app': patch
---

Add `narduk-app check-auto-imports`. Nuxt/Nitro auto-import every export of
`server/utils`, `shared/utils`, `app/utils` and `app/composables`; two files
exporting one name make unimport keep one and only warn ("Duplicated imports"),
so `nuxt prepare` exits 0 and a caller can bind to the wrong function. The
command runs `nuxt prepare` (or scans `--log <file>`) and exits 1, listing each
name with the file used and the file ignored, when any such warning appears;
exit 2 means prepare failed. A reworded warning fails rather than passing.
