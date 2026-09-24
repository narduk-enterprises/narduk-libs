/**
 * Public status / data-health page driven by narduk-core's `/api/health`
 * envelope (narduk-libs#370). This package does not own the health route and
 * does not import narduk-core: it consumes the published JSON contract so an
 * app can mount `/status` as an opt-in, no-auth page.
 */

const HEALTH_STATUSES = new Set(["ok", "degraded", "error"]);
const CHECK_RESULTS = new Set(["pass", "fail", "skipped"]);
const STATUS_LABEL = Object.freeze({
  ok: "Operational",
  degraded: "Degraded",
  error: "Outage",
});
const RESULT_LABEL = Object.freeze({
  pass: "Pass",
  fail: "Fail",
  skipped: "Skipped",
});

/**
 * @param {string} value
 * @returns {string}
 */
function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * @param {unknown} check
 * @returns {import("./index.d.mts").StatusPageCheck | null}
 */
function readCheck(check) {
  if (
    !isRecord(check) ||
    typeof check.name !== "string" ||
    typeof check.result !== "string" ||
    !CHECK_RESULTS.has(check.result)
  ) {
    return null;
  }
  const required = check.required === true;
  const notice = check.notice === true;
  /** @type {import("./index.d.mts").StatusPageCheck} */
  const view = {
    name: check.name,
    result: /** @type {"pass" | "fail" | "skipped"} */ (check.result),
    required,
    notice,
  };
  if (typeof check.kind === "string") view.kind = check.kind;
  if (typeof check.error === "string") view.error = check.error;
  if (typeof check.reason === "string") view.reason = check.reason;
  if (typeof check.durationMs === "number" && Number.isFinite(check.durationMs)) {
    view.durationMs = check.durationMs;
  }
  if (isRecord(check.detail)) view.detail = check.detail;
  return view;
}

/**
 * @param {import("./index.d.mts").StatusPageCheck} check
 * @returns {import("./index.d.mts").StatusPageProduct | null}
 */
function readProduct(check) {
  if (check.kind !== "freshness") return null;
  const detail = check.detail ?? {};
  const source = typeof detail.source === "string" ? detail.source : check.name;
  /** @type {import("./index.d.mts").StatusPageProduct} */
  const product = {
    name: check.name,
    source,
    result: check.result,
    notice: check.notice,
  };
  if (typeof detail.observedAt === "string") product.observedAt = detail.observedAt;
  if (typeof detail.ageSeconds === "number" && Number.isFinite(detail.ageSeconds)) {
    product.ageSeconds = detail.ageSeconds;
  }
  if (typeof detail.reason === "string") product.reason = detail.reason;
  return product;
}

/**
 * @param {unknown} report
 * @returns {import("./index.d.mts").StatusPageModel | null}
 */
function readReport(report) {
  if (
    !isRecord(report) ||
    typeof report.status !== "string" ||
    !HEALTH_STATUSES.has(report.status) ||
    typeof report.timestamp !== "string" ||
    typeof report.database !== "string" ||
    !Array.isArray(report.checks)
  ) {
    return null;
  }
  const checks = [];
  for (const entry of report.checks) {
    const check = readCheck(entry);
    if (!check) return null;
    checks.push(check);
  }
  const missingAuthTables = Array.isArray(report.missingAuthTables)
    ? report.missingAuthTables.filter((name) => typeof name === "string")
    : [];
  return {
    status: /** @type {"ok" | "degraded" | "error"} */ (report.status),
    timestamp: report.timestamp,
    database: report.database,
    missingAuthTables,
    checks,
    products: checks.map(readProduct).filter((product) => product !== null),
  };
}

/**
 * Read a narduk-core `GET /api/health` body, or the inner `data` object.
 *
 * @param {unknown} body
 * @returns {import("./index.d.mts").HealthEnvelopeParse}
 */
export function parseHealthEnvelope(body) {
  if (isRecord(body) && body.success === true && isRecord(body.data)) {
    const model = readReport(body.data);
    return model
      ? { ok: true, model }
      : { ok: false, error: "Health data does not match the narduk-core contract." };
  }
  if (isRecord(body) && body.success === false) {
    return { ok: false, error: "Health endpoint reported success: false." };
  }
  const model = readReport(body);
  return model
    ? { ok: true, model }
    : { ok: false, error: "Health data does not match the narduk-core contract." };
}

/**
 * @param {unknown} value
 * @returns {value is import("./index.d.mts").StatusPageModel}
 */
function isStatusPageModel(value) {
  return isRecord(value) && Array.isArray(value.checks) && Array.isArray(value.products);
}

/**
 * @param {string} label
 * @param {string} [appName]
 * @returns {string}
 */
function documentTitle(label, appName) {
  return appName ? `${label} — ${appName}` : label;
}

/**
 * @param {import("./index.d.mts").StatusPageProduct} product
 * @returns {string}
 */
function renderProduct(product) {
  const observed =
    typeof product.observedAt === "string"
      ? `<time datetime="${escapeHtml(product.observedAt)}">${escapeHtml(product.observedAt)}</time>`
      : "unknown observation time";
  const age =
    typeof product.ageSeconds === "number"
      ? ` · ${escapeHtml(String(product.ageSeconds))}s old`
      : "";
  const reason = product.reason ? ` · ${escapeHtml(product.reason)}` : "";
  const notice = product.notice ? " · notice" : "";
  return `<li><span>${escapeHtml(product.source)}</span> — ${RESULT_LABEL[product.result]}${notice} · ${observed}${age}${reason}</li>`;
}

/**
 * @param {import("./index.d.mts").StatusPageCheck} check
 * @returns {string}
 */
function renderCheckRow(check) {
  const detail = check.error || check.reason || check.kind || "";
  const notice = check.notice ? " (notice)" : "";
  return `<tr><th scope="row">${escapeHtml(check.name)}</th><td>${RESULT_LABEL[check.result]}${notice}</td><td>${escapeHtml(detail)}</td></tr>`;
}

/**
 * @param {import("./index.d.mts").StatusPageModel} model
 * @param {{ appName?: string }} [options]
 * @returns {string}
 */
function renderDocument(model, options = {}) {
  const label = STATUS_LABEL[model.status];
  const title = documentTitle("Status", options.appName);
  const products =
    model.products.length > 0
      ? `<ul>${model.products.map(renderProduct).join("")}</ul>`
      : "<p>No freshness checks are published.</p>";
  const missing =
    model.missingAuthTables.length > 0
      ? `<p>Missing auth tables: ${escapeHtml(model.missingAuthTables.join(", "))}</p>`
      : "";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="rgb(14 20 24)">
  <title>${escapeHtml(title)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=Instrument+Sans:ital,wght@0,400;0,500;0,600;0,700&display=swap">
  <style>
    body { margin: 0; font-family: "Instrument Sans", system-ui, sans-serif; background: rgb(14 20 24); color: rgb(236 241 244); }
    main { max-width: 48rem; margin: 0 auto; padding: 2rem 1.25rem 4rem; }
    h1, h2 { font-weight: 600; }
    time, td, th { font-family: "IBM Plex Mono", ui-monospace, monospace; }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; padding: 0.4rem 0.5rem; border-bottom: 1px solid rgb(48 60 68); }
    caption { text-align: left; font-weight: 600; padding-bottom: 0.5rem; }
  </style>
</head>
<body>
  <main>
    <h1>Status</h1>
    <p role="status">Overall status: ${escapeHtml(label)}</p>
    <p>Checked at <time datetime="${escapeHtml(model.timestamp)}">${escapeHtml(model.timestamp)}</time></p>
    <p>Database: ${escapeHtml(model.database)}</p>
    ${missing}
    <h2>Data freshness</h2>
    ${products}
    <h2>Checks</h2>
    <table>
      <caption>Health checks</caption>
      <thead><tr><th scope="col">Check</th><th scope="col">Result</th><th scope="col">Detail</th></tr></thead>
      <tbody>${model.checks.map(renderCheckRow).join("")}</tbody>
    </table>
  </main>
</body>
</html>
`;
}

/**
 * @param {string} error
 * @param {{ appName?: string }} [options]
 * @returns {string}
 */
function renderUnavailable(error, options = {}) {
  const title = documentTitle("Status unavailable", options.appName);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
</head>
<body>
  <main>
    <h1>Status unavailable</h1>
    <p role="status">Overall status: Unavailable</p>
    <p>${escapeHtml(error)}</p>
  </main>
</body>
</html>
`;
}

/**
 * Render a public, no-auth HTML page from a parsed model or a raw `/api/health`
 * body. Apps mount the result at `/status`.
 *
 * @param {unknown} input
 * @param {{ appName?: string }} [options]
 * @returns {string}
 */
export function renderStatusPage(input, options = {}) {
  if (isStatusPageModel(input) && HEALTH_STATUSES.has(input.status)) {
    return renderDocument(input, options);
  }
  const parsed = parseHealthEnvelope(input);
  return parsed.ok
    ? renderDocument(parsed.model, options)
    : renderUnavailable(parsed.error, options);
}
