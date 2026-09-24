---
'@narduk-enterprises/narduk-mapkit': minor
'@narduk-enterprises/create-narduk-app': patch
---

`rectBeside`, a leader overlay, and `hoveredId` for AppMapKit (design round 2, narduk-libs#517).

`rectBeside(rect, frame, point, anchor, options)` on `./client` is pure camera math beside `refreshMapKitMapLayout`: it returns the visible map rect that places a coordinate beside a DOM rect, with a gap, a vertical target, and one extra zoom step when the station is clustered.

`MapKitLeaderOverlay` follows an annotation's screen point on every region change, draws a line to an anchor element, and reports when the point is off screen. `<AppMapKit>` accepts the same overlay as the `leader` prop and emits `leader-offscreen`.

`hoveredId` (`v-model:hovered-id`) sits beside `selectedId`. The matching pin host carries `data-mapkit-hovered`; hover never adds or removes annotations.
