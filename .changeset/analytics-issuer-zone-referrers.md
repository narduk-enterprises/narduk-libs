---
'@narduk-enterprises/narduk-analytics': minor
'@narduk-enterprises/create-narduk-app': patch
---

Own both halves of the traffic-classification format and the shared analytics
primitives, so the operator portal stops keeping its own copies:

- `server/utils/traffic/trafficIssuer.ts`: `importTrafficSigner`,
  `signTrafficJws`, `mintEnrollmentToken` and `probeTrafficEnrollment`, moved
  verbatim from the portal's issuer. The wire format is unchanged, and a golden
  test pins tokens the portal minted before the move. Verification is unchanged,
  so product sites need no bump and enrolled browsers keep their claims.
  `TRAFFIC_ENROLLMENT_STEP_PATH` now lives in `trafficClaim.ts` (still
  auto-imported in Nitro under the same name).
- `server/utils/analyticsZone.ts`: the window's zone and calendar arithmetic,
  now with one cached `Intl.DateTimeFormat` per zone. `analyticsZoneParts` is
  exported for the first time. The moved names stay auto-imported in Nitro
  under the same names; a deep import from `analyticsWindow.ts` must now name
  `analyticsZone.ts` (no estate consumer does).
- Referrer grouping: `normalizeReferrerDomain` strips scheme and path and reads
  PostHog's `$direct` (and `(direct)`, `null`, `undefined`) as no referrer.
  Before, `$direct` landed in "Other" or "Referral".
  `google.`/`yahoo.`/`yandex.` entries no longer match a host that merely
  contains them (`notgoogle.com`). `bard.google.com`, `fb.com` and
  `mastodon.social` are added.
