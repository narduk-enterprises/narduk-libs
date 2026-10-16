---
'@narduk-enterprises/narduk-shell': patch
---

NeCommandPalette: pressing Cmd/Ctrl+K right after Escape reopens the palette. The shared open flag now follows the dialog's `cancel` event, and a queued `close` from the earlier Escape no longer undoes a newer open (riverstatus#543).
