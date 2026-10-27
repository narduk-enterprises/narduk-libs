---
'@narduk-enterprises/narduk-app-tools': patch
---

narduk-app-tools doctor item 9: the source-scan ceiling is now 10000 files (was 2000), so a large conformant app such as stonx reads Platform as `pass` instead of `unknown`; a scan that does reach the ceiling now stops walking instead of continuing past it.
