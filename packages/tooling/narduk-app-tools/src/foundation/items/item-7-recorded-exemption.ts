/**
 * Item 7 -- recorded exemption (spec §3 item 7, "Rollup-only").
 *
 * "An app's own CI cannot read `APP_REGISTRY.yaml`, so `foundation:check`
 * MUST report item 7 as `not-applicable`; an artefact claiming a decided
 * verdict on item 7 is rejected as F3." This is the one item with no
 * conditions to evaluate at all -- `buildArtefact()` in ../schema.ts also
 * throws if this ever returns anything but not-applicable, so a future edit
 * cannot silently break the F3 contract.
 */

import { check } from '../schema.js'
import { STATUS_NA, type FoundationSubCheck } from '../types.js'

export function evaluateItem7(): FoundationSubCheck[] {
  return [
    check(
      '7.0',
      'recorded exemption',
      STATUS_NA,
      "decided by the company-hq rollup against APP_REGISTRY.yaml, not by the app's own check",
    ),
  ]
}
