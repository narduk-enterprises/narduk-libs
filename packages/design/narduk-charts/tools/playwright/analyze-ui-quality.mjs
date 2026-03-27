import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const rootDir = path.resolve(process.argv[2] || 'output/playwright/ui-quality');
const summaryPath = path.join(rootDir, 'summary.json');
const markdownPath = path.join(rootDir, 'summary.md');
const manifestPath = path.join(rootDir, 'manifest.json');

if (!existsSync(rootDir)) {
  console.error(`UI quality root does not exist: ${rootDir}`);
  process.exit(1);
}

let sharpModule;
try {
  sharpModule = await import('sharp');
} catch (error) {
  console.error('Failed to load sharp for UI quality analysis.');
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const sharp = sharpModule.default;

function walkPngs(directory) {
  const entries = readdirSync(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkPngs(absolutePath));
      continue;
    }
    if (entry.isFile() && entry.name.toLowerCase().endsWith('.png')) {
      files.push(absolutePath);
    }
  }

  return files.sort();
}

function average(values) {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : null;
const screenshots = walkPngs(rootDir);

const failures = [];
const warnings = [];
const screenshotSummaries = [];
let fullPageCount = 0;

for (const file of screenshots) {
  const relativePath = path.relative(rootDir, file);
  const image = sharp(file);
  const [metadata, stats] = await Promise.all([image.metadata(), image.stats()]);
  const width = metadata.width || 0;
  const height = metadata.height || 0;
  const fileSizeBytes = statSync(file).size;
  const mean = average(stats.channels.map((channel) => channel.mean));
  const stdev = average(stats.channels.map((channel) => channel.stdev));
  const fileName = path.basename(relativePath);
  const isFullPage = fileName === 'page-full.png' || fileName === 'full-page.png';

  if (isFullPage) {
    fullPageCount += 1;
  }

  if (width < 160 || height < 100) {
    failures.push(`${relativePath} is unexpectedly small (${width}x${height})`);
  }

  if (isFullPage && stdev < 6) {
    failures.push(`${relativePath} looks visually flat (avg channel stdev ${stdev.toFixed(2)})`);
  } else if (!isFullPage && stdev < 3) {
    warnings.push(
      `${relativePath} has low visual variance (avg channel stdev ${stdev.toFixed(2)})`
    );
  }

  if (isFullPage && fileSizeBytes < 40_000) {
    failures.push(`${relativePath} is unusually small on disk (${fileSizeBytes} bytes)`);
  }

  screenshotSummaries.push({
    path: relativePath,
    width,
    height,
    fileSizeBytes,
    mean: Number(mean.toFixed(2)),
    avgChannelStdev: Number(stdev.toFixed(2)),
    isFullPage,
  });
}

// Derive effective thresholds: prefer explicit manifest fields, then infer from captures array.
const manifestCaptureCount = Array.isArray(manifest?.captures)
  ? manifest.captures.reduce((total, capture) => {
      const elementCount = Array.isArray(capture?.elementScreenshots)
        ? capture.elementScreenshots.length
        : 0;
      return total + 1 + elementCount;
    }, 0)
  : null;

const manifestFullPageCount = Array.isArray(manifest?.captures)
  ? manifest.captures.filter((capture) => capture?.pageScreenshot).length
  : null;

const effectiveMinimumScreenshotCount =
  manifest?.minimumScreenshotCount ?? manifestCaptureCount ?? 0;

const effectiveMinimumFullPageCount =
  manifest?.minimumFullPageCount ?? manifestFullPageCount ?? 0;

if (effectiveMinimumScreenshotCount > 0 && screenshots.length < effectiveMinimumScreenshotCount) {
  failures.push(
    `Expected at least ${effectiveMinimumScreenshotCount} screenshots but found ${screenshots.length}`
  );
}

if (effectiveMinimumFullPageCount > 0 && fullPageCount < effectiveMinimumFullPageCount) {
  failures.push(
    `Expected at least ${effectiveMinimumFullPageCount} full-page screenshots but found ${fullPageCount}`
  );
}

const score = Math.max(0, 100 - failures.length * 20 - warnings.length * 5);

const summary = {
  generatedAt: new Date().toISOString(),
  rootDir,
  app: manifest?.app || 'unknown',
  score,
  screenshotCount: screenshots.length,
  fullPageCount,
  failures,
  warnings,
  screenshots: screenshotSummaries,
};

writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');

const markdownLines = [
  '# UI Quality Summary',
  '',
  `- App: ${summary.app}`,
  `- Score: ${summary.score}`,
  `- Screenshots: ${summary.screenshotCount}`,
  `- Full-page screenshots: ${summary.fullPageCount}`,
  `- Failures: ${summary.failures.length}`,
  `- Warnings: ${summary.warnings.length}`,
  '',
];

if (summary.failures.length > 0) {
  markdownLines.push('## Failures', '');
  for (const failure of summary.failures) {
    markdownLines.push(`- ${failure}`);
  }
  markdownLines.push('');
}

if (summary.warnings.length > 0) {
  markdownLines.push('## Warnings', '');
  for (const warning of summary.warnings) {
    markdownLines.push(`- ${warning}`);
  }
  markdownLines.push('');
}

writeFileSync(markdownPath, `${markdownLines.join('\n')}\n`, 'utf8');

console.log(JSON.stringify(summary, null, 2));

if (summary.failures.length > 0) {
  process.exit(1);
}
