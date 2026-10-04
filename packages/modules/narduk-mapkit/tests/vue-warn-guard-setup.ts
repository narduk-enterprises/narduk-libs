/*
 * A `[Vue warn]` fails the test that caused it (narduk-libs#1403). Vue renders
 * an unresolved component as an unknown element and carries on, so without
 * this a test asserts against markup an app never ships and stays green. The
 * allowance list is empty on purpose; see the testkit's `vue-warn-guard` for how
 * to allow one warning, with a reason.
 */
import { installVueWarnGuard } from '@narduk-enterprises/narduk-testkit/vue-warn-guard'

installVueWarnGuard()
