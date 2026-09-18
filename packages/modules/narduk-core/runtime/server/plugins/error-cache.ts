import { getResponseStatus } from 'h3'
import { defineNitroPlugin } from 'nitropack/runtime'

import {
  applyNoStoreHeaders,
  applyNoStoreToEvent,
  applyNoStoreToWebResponse,
} from '../../shared/utils/shared-cache'

import type { H3Event } from 'h3'

export { applyNoStoreHeaders }

/**
 * Thrown 4xx/5xx (429 included) are `private, no-store` by default
 * (narduk-libs#429).
 *
 * Nitro's error page otherwise ships `Cache-Control: no-cache`, which
 * Cloudflare *stores* and revalidates once an app turns on Workers Cache
 * (`"cache": { "enabled": true }`). `no-store` / `private` are the documented
 * opt-out, so every thrown error gets them regardless of whether the route
 * ever called `setCacheProfile` — and even when it already called
 * `setCacheProfile(event, 'live')` before throwing, since Cache-Control was
 * already written by then.
 *
 * ## Which hooks actually see a thrown error, verified against nitropack
 * 2.13's `runtime/internal/app.mjs` and `runtime/internal/renderer.mjs`
 * (narduk-libs#429):
 *
 * - The `error` hook (`nitroApp.hooks.callHook('error', ...)`, fired via
 *   `captureError`) is **not usable here**: h3's `onError` calls
 *   `captureError` un-awaited (`.catch()`, no `await`) and then immediately
 *   calls the `errorHandler` chain that produces the response. A header
 *   written from the `error` hook races the response and is not guaranteed
 *   to land before it is sent — the same reason `error-sanitizer.ts` gives
 *   for not using this hook to sanitize the error body.
 * - `render:response` **is** usable: `defineRenderHandler` awaits
 *   `ctx.render(event)` — which is where Nuxt's SSR renderer catches a thrown
 *   error and renders `error.vue`, setting `ctx.response.statusCode` to the
 *   error's status — before calling `nitroApp.hooks.callHook('render:response',
 *   ctx.response, ctx)` and only then copying `ctx.response.headers` onto the
 *   event. This is the SSR error page path (a page that throws
 *   `createError()`, or a 404).
 * - `beforeResponse` **is** usable for everything else: h3's `onError`
 *   produces the error response synchronously and h3 still calls
 *   `onBeforeResponse` (which nitropack forwards as the `beforeResponse`
 *   hook) before sending it — the API-route path (`defineRateLimitedHandler`'s
 *   429, a route that throws `createError()`). This is proven by the existing
 *   `preferences-cache` plugin's own test suite
 *   (`'keeps a thrown createError response out of a shared cache'` in
 *   `tests/preferences-cache.test.ts`), which drives a thrown 503 through
 *   exactly this hook and gets a rewritten `Cache-Control` back.
 *
 * Modelled on `preferences-cache.ts`: `render:response` rewrites the header
 * map Nitro is about to copy onto the event, and `beforeResponse` is the
 * last-moment backstop that also has to sanitise a returned web `Response`,
 * because h3 writes a returned `Response`'s own headers onto `event.node.res`
 * *after* `beforeResponse` runs.
 *
 * No `Vary` is added here — unlike the preferences plugin, an error response
 * does not vary by cookie or `Accept-Language` on its own account, so this
 * plugin's `varyTokens` stay empty and any `Vary` a route already set survives
 * untouched.
 */
export default defineNitroPlugin((nitro) => {
  nitro.hooks.hook('render:response', (response, context) => {
    const event = context?.event as H3Event | undefined
    const status = response?.statusCode ?? (event ? getResponseStatus(event) : 200)
    if (status < 400) return
    response.headers = applyNoStoreHeaders(response.headers ?? {})
  })
  nitro.hooks.hook('beforeResponse', (event, response) => {
    // h3 writes a returned `Response`'s own status onto `event.node.res`
    // *after* this hook runs (`createAppEventHandler` calls
    // `onBeforeResponse` before `handleHandlerResponse`), so a route that
    // `return`s `new Response(body, { status: 503 })` rather than throwing
    // still has `getResponseStatus(event)` read 200 here. Read the body's own
    // status first and fall back to the event, which is already correct for
    // every *thrown* error: h3's `onError` calls `setResponseStatus(event,
    // error.statusCode, ...)` before it calls `onBeforeResponse`.
    const body = (response as { body?: unknown } | undefined)?.body
    const bodyStatus = (body as { status?: unknown } | undefined)?.status
    const status = typeof bodyStatus === 'number' ? bodyStatus : getResponseStatus(event)
    if (status < 400) return

    applyNoStoreToEvent(event)
    // The response body itself has to be sanitised while it is still
    // mutable, for the same reason the status has to be read from it above.
    const sanitized = applyNoStoreToWebResponse(body)
    if (sanitized && response) (response as { body?: unknown }).body = sanitized
  })
})
