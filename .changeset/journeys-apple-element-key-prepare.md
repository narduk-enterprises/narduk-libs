---
'@narduk-enterprises/journeys': minor
---

Apple driven journeys can press a control by accessibility identifier
(`{ kind: 'element', id }`) and press hardware-keyboard keys
(`{ kind: 'key', key, repeat? }`). The world gains optional `prepare` and
`generation` hooks. The declared `start` landing is now checked even when
`world.confirm` names the scenario. An unknown gesture kind is refused when the
catalog loads and when the press is performed, where before it did nothing
(narduk-libs#75).
