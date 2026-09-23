---
'@narduk-enterprises/narduk-core': patch
'@narduk-enterprises/create-narduk-app': patch
---

Fix three defects that made core's own components break in a consuming app, where core is installed as a module:

- LayerAppFooter (`useSsrNow`), AppBreadcrumbs (`toRef`) and `useFormHandler` (`readonly`) called names the app runtime import bridge did not inject, so they threw `ReferenceError` during SSR and failed prerendering. The seo and analytics admin panels had the same gap for `useOgImagePreviewResolver`, `normalizeOgPreviewSections`, `useAdminGaOverview`, `useAdminGscPerformance` and `useAdminPosthogDashboard`. All are now bridged, and a test scans every bridged app file so the lists cannot drift again.
- `main.css` now declares `@source` for core's `runtime/app`. Tailwind skips `node_modules`, so utilities used only by core components were never generated; LayerAppHeader's desktop nav (`hidden md:flex`) stayed hidden at every width.
