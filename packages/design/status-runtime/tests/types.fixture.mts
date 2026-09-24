import {
  designSystemFontLinks,
  designSystemThemeColor,
  parseHealthEnvelope,
  renderStatusPage,
  resolveSourceRevision,
} from "@narduk-enterprises/status-runtime";

const revision: string = resolveSourceRevision({
  NARDUK_SOURCE_REVISION: "exact-sha",
  GITHUB_SHA: undefined,
});
const fontLinks: ReadonlyArray<{
  crossorigin?: "" | undefined;
  href: string;
  rel: string;
}> = designSystemFontLinks;
const themeColor: "rgb(14 20 24)" = designSystemThemeColor;

// @ts-expect-error Environment values must be strings when present.
resolveSourceRevision({ NARDUK_SOURCE_REVISION: 42 });

const parsed = parseHealthEnvelope({
  success: true,
  data: {
    status: "ok",
    timestamp: "2026-09-16T17:00:00.000Z",
    database: "ok",
    missingAuthTables: [],
    checks: [],
  },
});
const page: string = renderStatusPage(parsed.ok ? parsed.model : parsed.error);

void revision;
void fontLinks;
void themeColor;
void parsed;
void page;
