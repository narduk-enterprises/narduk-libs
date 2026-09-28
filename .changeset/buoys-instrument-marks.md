---
"@narduk-enterprises/narduk-mapkit": minor
"@narduk-enterprises/create-narduk-app": patch
---

Add the instrument mark renderer and path geometry at `./instrument-marks`, with opt-in `marks: 'instruments'` styling. This moves reusable SVG/DOM behavior out of Buoys without changing the existing `./marks` disc API or its default stylesheet. Product thresholds, labels, colors and lens selection stay in the app.

Also share `useMapKitLayoutSettle` for bare MapKit hosts, preserving the measured tile-layout repair while restoring inline height and cancelling pending frames on disposal or replacement.

Add opt-in `chrome: true` Vue map controls, keyboard menus, notices and instrument legends so apps supply product inputs without copying reusable UI behavior.
