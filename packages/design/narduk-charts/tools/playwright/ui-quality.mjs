import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect } from '@playwright/test';

export function slugify(value) {
  return value
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/(^-|-$)/g, '');
}

export function prepareUiQualityRoot(rootDir) {
  if (typeof rootDir !== 'string' || rootDir.trim() === '') {
    throw new Error('prepareUiQualityRoot: "rootDir" must be a non-empty string');
  }

  const resolvedRoot = path.resolve(rootDir);
  const filesystemRoot = path.parse(resolvedRoot).root;
  const cwd = process.cwd();

  if (resolvedRoot === filesystemRoot) {
    throw new Error(
      `prepareUiQualityRoot: refusing to remove filesystem root: ${resolvedRoot}`
    );
  }

  if (resolvedRoot === cwd) {
    throw new Error(
      `prepareUiQualityRoot: refusing to remove current working directory: ${resolvedRoot}`
    );
  }

  const relativeToCwd = path.relative(cwd, resolvedRoot);
  if (relativeToCwd.startsWith('..') || path.isAbsolute(relativeToCwd)) {
    throw new Error(
      `prepareUiQualityRoot: refusing to remove directory outside current working directory: ${resolvedRoot}`
    );
  }

  rmSync(resolvedRoot, { recursive: true, force: true });
  mkdirSync(resolvedRoot, { recursive: true });
}

export function writeUiQualityManifest(rootDir, manifest) {
  writeFileSync(
    path.join(rootDir, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8'
  );
}

async function captureLocatorScreenshot(page, locator, screenshotPath) {
  await locator.evaluate((element) => {
    if (element instanceof HTMLElement) {
      element.scrollIntoView({ block: 'center', inline: 'center' });
    }
  });
  await page.waitForTimeout(150);
  await locator.screenshot({ path: screenshotPath });
}

async function withStickyChromeSuppressed(page, fn) {
  await page.evaluate(() => {
    const style = document.createElement('style');
    style.id = 'playwright-ui-quality-suppress-sticky';
    style.textContent = `
      header.sticky,
      nav.sticky,
      section.sticky,
      [class*=" sticky"],
      [class^="sticky"] {
        opacity: 0 !important;
        pointer-events: none !important;
      }
    `;
    document.head.append(style);
  });

  try {
    await fn();
  } finally {
    await page.evaluate(() => {
      document.getElementById('playwright-ui-quality-suppress-sticky')?.remove();
    });
  }
}

export async function captureNamedLocator(page, locator, name, directory, captures, options = {}) {
  await expect(locator).toBeVisible();
  const screenshotPath = path.join(directory, `${slugify(name)}.png`);

  if (options.suppressStickyChrome === false) {
    await captureLocatorScreenshot(page, locator, screenshotPath);
  } else {
    await withStickyChromeSuppressed(page, async () => {
      await captureLocatorScreenshot(page, locator, screenshotPath);
    });
  }

  captures.push({ name, path: screenshotPath });
}

export async function captureFullPageAudit(page, rootDir, route, title, captureElements) {
  const directory = path.join(rootDir, slugify(title));
  mkdirSync(directory, { recursive: true });

  const pageScreenshot = path.join(directory, 'page-full.png');
  await page.screenshot({
    path: pageScreenshot,
    fullPage: true,
  });

  const elementScreenshots = [];
  await captureElements(directory, elementScreenshots);

  return {
    id: slugify(title),
    route,
    title,
    pageScreenshot,
    elementScreenshots,
  };
}

export function createConsoleTracker(page, ignoredPatterns = []) {
  const issues = [];

  page.on('console', (message) => {
    const type = message.type();
    const text = message.text();

    if (
      (type === 'error' || type === 'warning') &&
      !ignoredPatterns.some((pattern) => pattern.test(text))
    ) {
      issues.push(`[console:${type}] ${text}`);
    }
  });

  page.on('pageerror', (error) => {
    issues.push(`[pageerror] ${error.message}`);
  });

  return {
    async expectClean() {
      expect(issues, issues.join('\n')).toEqual([]);
    },
  };
}

const uiQuality = {
  captureFullPageAudit,
  captureNamedLocator,
  createConsoleTracker,
  prepareUiQualityRoot,
  slugify,
  writeUiQualityManifest,
};

export default uiQuality;
