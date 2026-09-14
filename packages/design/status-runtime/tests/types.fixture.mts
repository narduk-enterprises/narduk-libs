import {
  designSystemFontLinks,
  designSystemThemeColor,
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

void revision;
void fontLinks;
void themeColor;
