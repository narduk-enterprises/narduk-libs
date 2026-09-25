---
'@narduk-enterprises/narduk-core': patch
'@narduk-enterprises/create-narduk-app': patch
---

The legacy enforcing CSP no longer allows `https://pagead2.googlesyndication.com` in `script-src` for every app. An app that serves AdSense adds the origin itself with `runtimeConfig.public.cspScriptSrc` / `CSP_SCRIPT_SRC`, plus the frame and connect origins its ads need (narduk-libs#459).
