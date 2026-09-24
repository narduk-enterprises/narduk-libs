---
'@narduk-enterprises/journeys': patch
---

Apple captures re-encode the simulator recording through the same
libx264 / `+faststart` normalisation the web path already uses. The raw
take stays in the attempt as `video.raw.mp4`; the published artefact is
the normalised `video.mp4`. Capture profiles may declare `preset`, `crf`
and `maxLongEdge` (narduk-libs#115).
