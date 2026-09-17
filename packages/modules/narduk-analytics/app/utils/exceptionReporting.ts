import type { NardukExceptionReport } from '@narduk-enterprises/narduk-core/shared/exception-report'
import type { PostHog, Properties } from 'posthog-js'

/**
 * Exception reporting is PostHog's own Error tracking product, not a second
 * pipeline of ours.
 *
 * `posthog-js` offers two ways in. `capture_exceptions` autocapture is the
 * advertised one, but it is an *externally loaded* extension — the bundle calls
 * `__PosthogExtensions__.loadExternalDependency(instance, 'exception-autocapture', …)`
 * — and that loader refuses to run whenever `disable_external_dependency_loading`
 * is set, which is this module's default posture whenever session replay is off
 * (see `posthog.client`, and the identical web-vitals gap in `webVitals`).
 * Turning it on would therefore be a switch that silently does nothing.
 *
 * `posthog.captureException()` is bundled in the main module, is PostHog's
 * documented public API, and produces the same `$exception` event the
 * autocapture extension produces, so the Error tracking UI works with no
 * further setup. That is what this reporter calls.
 *
 * What is captured comes from narduk-core's `narduk:exception` seam — one hook
 * fed by `vue:error`, `app:error` and Nitro's `error` hook — so this module
 * installs no error listeners of its own.
 */

/** The subset of the PostHog client this reporter uses. */
export interface PostHogExceptionClient {
  captureException: PostHog['captureException']
  has_opted_out_capturing?: PostHog['has_opted_out_capturing']
}

/**
 * The properties attached to `$exception`. Every one is low cardinality and
 * carries no identifier: the route is a **pattern**, and the message arrives
 * already redacted by narduk-core.
 *
 * The app id rides along as the `app` super property `posthog.client`
 * registers, so it is not duplicated here.
 */
export function buildPostHogExceptionProperties(report: NardukExceptionReport): Properties {
  const properties: Properties = {
    route: report.route,
    source: report.source,
    status_code: report.statusCode,
    fatal: report.fatal,
    redacted_message: report.message,
  }

  if (report.buildVersion) properties.build_version = report.buildVersion
  if (report.requestId) properties.request_id = report.requestId

  return properties
}

/**
 * Reports one exception, or reports nothing at all.
 *
 * Nothing is reported when analytics never initialized (no key, preview safe
 * mode, localhost, `analyticsLoadStrategy: 'off'` — `posthog.client` provides
 * `undefined` in every one of those cases) or when the visitor has opted out of
 * capture. A reporter must never be the thing that resurrects a disabled
 * pipeline.
 */
export function reportExceptionToPostHog(
  posthog: PostHogExceptionClient | undefined,
  report: NardukExceptionReport,
): boolean {
  if (!posthog) return false
  if (posthog.has_opted_out_capturing?.()) return false

  posthog.captureException(report.error, buildPostHogExceptionProperties(report))
  return true
}
