/**
 * Resolve the exact source revision the build is being produced from.
 *
 * An explicit `NARDUK_SOURCE_REVISION` wins over the ambient CI variables.
 *
 * @param env environment values to resolve; defaults to `process.env`
 * @returns the revision, or an empty string outside CI
 */
export function resolveSourceRevision(env?: Record<string, string | undefined>): string;

/**
 * The Narduk Status Design System font request shared by all five status apps.
 */
export const designSystemFontLinks: ReadonlyArray<
  | {
      crossorigin?: undefined;
      href: string;
      rel: string;
    }
  | {
      crossorigin: "";
      href: string;
      rel: string;
    }
>;

/**
 * The design system's page-ground colour for `<meta name="theme-color">`.
 */
export const designSystemThemeColor: "rgb(14 20 24)";

export type HealthStatus = "ok" | "degraded" | "error";
export type HealthCheckResult = "pass" | "fail" | "skipped";

export interface StatusPageCheck {
  detail?: Record<string, unknown>;
  durationMs?: number;
  error?: string;
  kind?: string;
  name: string;
  notice: boolean;
  reason?: string;
  required: boolean;
  result: HealthCheckResult;
}

export interface StatusPageProduct {
  ageSeconds?: number;
  name: string;
  notice: boolean;
  observedAt?: string;
  reason?: string;
  result: HealthCheckResult;
  source: string;
}

export interface StatusPageModel {
  checks: StatusPageCheck[];
  database: string;
  missingAuthTables: string[];
  products: StatusPageProduct[];
  status: HealthStatus;
  timestamp: string;
}

export type HealthEnvelopeParse =
  | { error: string; model?: undefined; ok: false }
  | { error?: undefined; model: StatusPageModel; ok: true };

/**
 * Read a narduk-core `GET /api/health` envelope, or the inner `data` object.
 */
export function parseHealthEnvelope(body: unknown): HealthEnvelopeParse;

/**
 * Render a public, no-auth HTML status page from a parsed model or raw body.
 */
export function renderStatusPage(input: unknown, options?: { appName?: string }): string;
