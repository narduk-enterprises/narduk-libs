/**
 * The role vocabulary for `bindings.r2[]` entries in `Config/cloudflare-app.json`
 * (narduk-libs#1285). A role says what a bucket is for, so foundation item 3.3
 * ("writes R2: narduk-uploads") applies only to buckets that take user uploads.
 *
 * - `uploads` (the default when `role` is absent): user-uploaded objects through
 *   narduk-uploads (`POST /api/upload`, `GET /images/**`, binding `BUCKET`).
 * - `read-only-assets`: objects filled outside the app and only read by it.
 * - `archive`: a cold or historical store the app does not take user uploads into.
 * - `app-data`: server-written application data that is not user uploads, such
 *   as a timeline store written by a bearer-token server `PUT`.
 */

import { isRecord } from './foundation/source.js'

export const R2_BUCKET_ROLES = ['uploads', 'read-only-assets', 'archive', 'app-data'] as const
export type R2BucketRole = (typeof R2_BUCKET_ROLES)[number]

export const DEFAULT_R2_BUCKET_ROLE: R2BucketRole = 'uploads'

export function isR2BucketRole(value: unknown): value is R2BucketRole {
  return typeof value === 'string' && (R2_BUCKET_ROLES as readonly string[]).includes(value)
}

export interface ManifestR2Bucket {
  /** The binding name; `null` for an entry that names none. */
  binding: string | null
  /** The declared role, or `uploads` when absent. An unrecognised value stays as written. */
  role: string
  /** True when `role` was not declared and defaulted to `uploads`. */
  defaulted: boolean
}

/** The `bindings.r2[]` entries of a parsed `Config/cloudflare-app.json`. */
export function manifestR2Buckets(manifest: unknown): ManifestR2Bucket[] {
  const bindings = isRecord(manifest) && isRecord(manifest.bindings) ? manifest.bindings : null
  const list = bindings && Array.isArray(bindings.r2) ? (bindings.r2 as unknown[]) : []
  return list.map((entry) => {
    if (!isRecord(entry)) {
      return {
        binding: typeof entry === 'string' ? entry : null,
        role: DEFAULT_R2_BUCKET_ROLE,
        defaulted: true,
      }
    }
    const declared = entry.role !== undefined && entry.role !== null
    return {
      binding: typeof entry.binding === 'string' ? entry.binding : null,
      role: declared ? String(entry.role) : DEFAULT_R2_BUCKET_ROLE,
      defaulted: !declared,
    }
  })
}
