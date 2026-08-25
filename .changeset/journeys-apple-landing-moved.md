---
'@narduk-enterprises/journeys': patch
---

Apple: a beat's landing must also prove the screen moved.

Found by the adapter's first live run against a real simulator. A landing
predicate that was already satisfied BEFORE the gesture passed instantly, which
proves nothing about the gesture: a scroll beat whose text reads the same at the
top and the bottom of the board passed the moment it was asked, and the beat
after it then pressed a coordinate the scroll had not reached yet. Nothing was
red — the exact wrong-but-green shape per-beat verification exists to kill.

Every beat now also requires the accessibility hierarchy to differ from what it
was before its gesture. The comparison is a sorted token multiset rather than
raw text, because `idb ui describe-all` serialises its JSON keys in a different
order on every call while a scroll genuinely changes the frame numbers — so this
detects real movement without knowing anything about the injector's schema.

`lands.unchanged: true` declares the rare beat for which standing still is the
expected outcome. A `wait` gesture is exempt by construction.

A beat also waits for the screen to STOP moving — two consecutive reads that
agree — before it passes. A decelerating scroll reads "right" long before it
settles, and the next beat's coordinate is pressed against wherever it ends up.
This is pacing for correctness and is identical in both modes; narrative dwell
remains the separate, capture-only thing that happens after a beat has passed.

The walkthrough can also assemble a story whose halves ran in different places:
`environments` (CLI `--env-<surface>`) beside the existing per-surface profiles,
because a web journey runs against a deployment and a handset journey against an
in-app fixture world. The mixed-application-revision guard is now per surface
for the same reason — a web app and a phone app are two applications with two
version schemes, and demanding the override on every cross-surface page would
turn the guard into noise.
