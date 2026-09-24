---
'@narduk-enterprises/journeys': patch
---

The web capture encode is async and single-flight, so `ffmpeg` no longer
`spawnSync`-blocks the Playwright worker. A web profile may declare
`video: { preset, crf, maxBytes }`, and a missing ffmpeg or ffprobe is
recorded on the run manifest (narduk-libs#114).
