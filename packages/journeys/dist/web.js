/**
 * The web adapter (§6.2): a thin layer on Playwright Test, registered from a
 * spec file. This module is the package's only Playwright import — the core
 * stays runtime-neutral, and `@playwright/test` is an optional peer.
 *
 * The spec marked the engine choice provisional pending exactly this
 * implementation; deviations found while building are recorded in the PR, not
 * silently absorbed.
 */
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from '@playwright/test';
import { RUN_SCHEMA } from './types.js';
import { expectedStepIds, runPaths } from './verify.js';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function sha256File(path) {
    return `sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}`;
}
/**
 * GET-only, same-origin, JSON-only — by construction (§2.3). A throw anywhere
 * in here fails the step; the adapter never converts a query failure into a
 * skip.
 */
export function createWorldQuery(base) {
    return {
        base,
        async get(path) {
            if (!path.startsWith('/')) {
                throw new Error(`world query paths are same-origin and absolute; got "${path}"`);
            }
            const response = await fetch(base + path, {
                method: 'GET',
                headers: { accept: 'application/json' },
            });
            if (!response.ok) {
                throw new Error(`world query ${path} returned ${response.status}`);
            }
            const contentType = response.headers.get('content-type') ?? '';
            if (contentType.includes('text/html')) {
                throw new Error(`world query ${path} returned text/html: probing the rendered page is the ` +
                    'forbidden UI probe through a side door');
            }
            const body = await response.text();
            try {
                return JSON.parse(body);
            }
            catch {
                throw new Error(`world query ${path} did not return JSON`);
            }
        },
    };
}
function createContextApi(page, base, mode) {
    const paced = mode === 'capture';
    return {
        page,
        base,
        async must(name, opts = {}) {
            const role = (opts.role ?? 'button');
            const locator = page.getByRole(role, { name }).nth(opts.nth ?? 0);
            await locator.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => { });
            if ((await locator.count()) === 0) {
                throw new Error(`no ${String(role)} matching ${String(name)}`);
            }
            await locator.scrollIntoViewIfNeeded().catch(() => { });
            await locator.click({ timeout: 8_000 });
            if (paced)
                await sleep(400);
        },
        async goto(path) {
            await page.goto(base + path, { waitUntil: 'load', timeout: 45_000 });
            await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => { });
            if (paced)
                await sleep(700);
        },
        async beat(ms) {
            if (paced)
                await sleep(ms);
        },
        async read(screens = 2) {
            if (!paced)
                return;
            for (let index = 0; index < screens; index += 1) {
                await page.mouse.wheel(0, 520);
                await sleep(600);
            }
            await page.mouse.wheel(0, -520 * screens);
            await sleep(400);
        },
        async point(text) {
            if (!paced)
                return;
            const locator = page.getByText(text).first();
            if ((await locator.count()) === 0)
                return;
            await locator.scrollIntoViewIfNeeded().catch(() => { });
            await locator.hover({ timeout: 4_000 }).catch(() => { });
            await sleep(900);
        },
    };
}
function runId(commit, startedAt) {
    const stamp = startedAt
        .toISOString()
        .replaceAll(/[-:]/g, '')
        .replace(/\..*$/, '')
        .replace('T', '-');
    return `${stamp}-${commit.slice(0, 8)}`;
}
function toMp4(webmPath, mp4Path) {
    const result = spawnSync('ffmpeg', [
        '-y',
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        webmPath,
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        '-movflags',
        '+faststart',
        '-an',
        mp4Path,
    ]);
    return result.status === 0 && existsSync(mp4Path);
}
function videoSeconds(path) {
    const result = spawnSync('ffprobe', [
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-of',
        'default=noprint_wrappers=1:nokey=1',
        path,
    ], { encoding: 'utf8' });
    const seconds = Number.parseFloat((result.stdout || '').trim());
    return Number.isFinite(seconds) ? seconds : null;
}
/**
 * Register one Playwright `test()` per web journey, one `test.step()` per
 * declared step. Call from a spec file. Journeys sharing a world run serially
 * inside one worker by construction here (registration order); isolation
 * across targets is the caller's arrangement per the world-session rules (§5).
 */
export function registerJourneys(options) {
    const mode = options.mode ?? (process.env.JOURNEYS_MODE === 'capture' ? 'capture' : 'test');
    const commit = options.commit ?? process.env.JOURNEYS_COMMIT ?? 'uncommitted';
    const profile = options.catalog.profiles[options.profileName];
    if (!profile || profile.kind !== 'web') {
        throw new Error(`profile "${options.profileName}" is not a declared web profile`);
    }
    const journeys = options.catalog.journeys.filter((journey) => journey.surface === 'web' && (!options.only || options.only.includes(journey.id)));
    for (const journey of journeys) {
        // Capture runs the FIRST declared scenario (§2.2); test mode runs each.
        const scenarioIds = mode === 'capture' ? [journey.scenarios[0]] : journey.scenarios;
        for (const scenarioId of scenarioIds) {
            const testTitle = scenarioIds.length > 1 ? `${journey.id} [${scenarioId}]` : journey.id;
            test(testTitle, async ({ browser }) => {
                await runJourney({
                    journey,
                    scenarioId,
                    mode,
                    commit,
                    profile,
                    options,
                    browser,
                });
            });
        }
    }
}
async function runJourney(args) {
    const { journey, scenarioId, mode, commit, profile, options, browser } = args;
    const startedAt = new Date();
    const attemptId = runId(commit, startedAt);
    const paths = runPaths({
        outRoot: options.outRoot,
        environment: options.environment,
        surface: 'web',
        journeyId: journey.id,
        profileName: options.profileName,
        mode,
        runId: attemptId,
    });
    mkdirSync(join(paths.attemptDirectory, 'steps'), { recursive: true });
    const prepared = await options.world.prepare(scenarioId);
    const confirmed = prepared.scenarioId === scenarioId;
    const appRevision = await options.world.appRevision();
    const audienceEntry = options.catalog.audience[journey.role];
    if (!audienceEntry)
        throw new Error(`unknown role "${journey.role}"`);
    const videoTmp = mode === 'capture' ? mkdtempSync(join(tmpdir(), 'njr-video-')) : null;
    let storageState;
    // §2.5: recording is suspended while a secret-class authentication hook
    // runs. A context cannot pause its video, so the hook runs in a separate,
    // never-recorded context and only its session state crosses over.
    if (mode === 'capture' && audienceEntry.credentialClass === 'secret') {
        const authContext = await browser.newContext({ viewport: profile.viewport });
        const authPage = await authContext.newPage();
        await audienceEntry.web(authPage, options.base);
        storageState = await authContext.storageState();
        await authContext.close();
    }
    const context = await browser.newContext({
        viewport: profile.viewport,
        deviceScaleFactor: profile.dpr,
        colorScheme: profile.colorScheme,
        ...(storageState ? { storageState } : {}),
        ...(videoTmp ? { recordVideo: { dir: videoTmp, size: profile.viewport } } : {}),
    });
    const recordingStart = Date.now();
    const page = await context.newPage();
    const api = createContextApi(page, options.base, mode);
    const world = createWorldQuery(options.base);
    if (!storageState && audienceEntry.web) {
        await audienceEntry.web(page, options.base);
    }
    const included = new Set(expectedStepIds(journey, scenarioId));
    const steps = [];
    let failure;
    let ordinal = 0;
    for (const step of journey.steps) {
        if (!included.has(step.id))
            continue;
        ordinal += 1;
        const startedMs = Date.now() - recordingStart;
        const record = {
            id: step.id,
            ordinal,
            status: 'passed',
            say: step.say,
            startedMs,
            endedMs: startedMs,
        };
        steps.push(record);
        try {
            if (step.appliesIf) {
                const verdict = await step.appliesIf(world);
                if (!verdict.applicable) {
                    record.status = 'skipped-not-applicable';
                    record.skipReason = verdict.reason;
                    record.endedMs = Date.now() - recordingStart;
                    continue;
                }
            }
            await test.step(step.say, async () => {
                await step.do(api);
                if (mode === 'capture' && step.capture?.dwell)
                    await sleep(step.capture.dwell);
            });
            record.endedMs = Date.now() - recordingStart;
            if (mode === 'capture') {
                const shot = `steps/${String(ordinal).padStart(2, '0')}-${step.id}.png`;
                await page.screenshot({ path: join(paths.attemptDirectory, shot) });
                record.shot = shot;
                record.shotSha256 = sha256File(join(paths.attemptDirectory, shot));
            }
        }
        catch (error) {
            record.status = 'failed';
            record.error = error instanceof Error ? error.message : String(error);
            record.endedMs = Date.now() - recordingStart;
            failure = error;
            break;
        }
    }
    const generationAfter = await options.world.generation();
    await context.close();
    let video;
    if (videoTmp) {
        const webm = readdirSync(videoTmp).find((file) => file.endsWith('.webm'));
        if (webm) {
            const webmPath = join(paths.attemptDirectory, 'video.webm');
            copyFileSync(join(videoTmp, webm), webmPath);
            const mp4Path = join(paths.attemptDirectory, 'video.mp4');
            const converted = toMp4(webmPath, mp4Path);
            if (converted)
                rmSync(webmPath, { force: true });
            const file = converted ? 'video.mp4' : 'video.webm';
            const fullPath = join(paths.attemptDirectory, file);
            video = { file, seconds: videoSeconds(fullPath), sha256: sha256File(fullPath) };
        }
        rmSync(videoTmp, { force: true, recursive: true });
    }
    const generationInterference = generationAfter !== prepared.generation;
    const manifest = {
        schema: RUN_SCHEMA,
        journey: journey.id,
        surface: 'web',
        mode,
        base: options.base,
        commit,
        declarationDigest: options.declarationDigest,
        appRevision,
        profile: {
            name: options.profileName,
            browser: browser.browserType().name(),
            browserVersion: browser.version(),
            viewport: `${profile.viewport.width}x${profile.viewport.height}`,
            dpr: profile.dpr ?? 1,
            colorScheme: profile.colorScheme ?? 'light',
        },
        startedAt: startedAt.toISOString(),
        scenario: {
            id: scenarioId,
            confirmed,
            generation: prepared.generation,
            generationAfter,
            preparedBy: 'fresh-load',
        },
        verdict: failure || !confirmed || generationInterference ? 'failed' : 'passed',
        steps,
        ...(video ? { video } : {}),
    };
    writeFileSync(join(paths.attemptDirectory, 'run.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    if (failure)
        throw failure;
    if (!confirmed) {
        throw new Error(`world confirmed scenario "${prepared.scenarioId}", asked for "${scenarioId}"`);
    }
    if (generationInterference) {
        throw new Error(`world generation changed mid-journey ("${prepared.generation}" to "${generationAfter}") — ` +
            'the world was replaced under the journey and every artefact after that is evidence of nothing');
    }
}
//# sourceMappingURL=web.js.map