---
'@narduk-enterprises/narduk-shell': minor
'@narduk-enterprises/create-narduk-app': patch
---

NeFilterBar: a `ui` prop appends consumer classes to the row's parts (`root`, `controls`, `control`, `selected`, `count`, `note`) so an app with its own design system can draw the bar without forking it, and a control's count is now separated from its label by a space so its accessible name reads "Open 3" rather than "Open3".
