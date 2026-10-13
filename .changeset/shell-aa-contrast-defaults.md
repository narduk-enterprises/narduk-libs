---
'@narduk-enterprises/narduk-shell': patch
---

Ship AA-passing default colours: solid primary/secondary/success/info/warning/error read the 700 shade in light mode (400 in dark), `--ui-text-dimmed` reads the new AA `--ne-ink-dimmed-text`, and every theme selector is wrapped in `:where()` so a plain `:root` rule overrides any token (#1785). `NeFilterBar` counts no longer use `opacity-70`, so the selected chip count meets AA (#1447).
