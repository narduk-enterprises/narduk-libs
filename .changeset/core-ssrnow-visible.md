---
'@narduk-enterprises/narduk-core': patch
---

`useSsrNow(key, { tickMs })` also re-reads the browser clock when the page
becomes visible again, so a viewer returning to a background tab sees current
relative ages at once instead of after the next (throttled) tick. The listener
is registered only for a ticking clock and removed on unmount. This closes the
last gap between `useSsrNow` and the Buoys map clock it generalises.
