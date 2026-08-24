/**
 * The journeys CLI: the consumers that need real logic beyond the engines.
 * Test and capture execution go through Playwright Test with the ./web
 * adapter; this binary owns rehearse, verify, promote and walkthrough.
 */
import { basename, resolve } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { defineCatalog } from '../define.js';
import { digestDirectory } from '../digest.js';
import { buildRehearsal } from '../rehearse.js';
import { promoteRun, readRunManifest, verifyRun } from '../verify.js';
import { buildWalkthrough } from '../walkthrough.js';
function parseArgs(argv) {
    const flags = { positional: [], named: new Map(), bare: new Set() };
    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        if (!argument.startsWith('--')) {
            flags.positional.push(argument);
            continue;
        }
        const name = argument.slice(2);
        const next = argv[index + 1];
        if (next !== undefined && !next.startsWith('--')) {
            flags.named.set(name, next);
            index += 1;
        }
        else {
            flags.bare.add(name);
        }
    }
    return flags;
}
async function loadCatalog(flags) {
    const modulePath = flags.named.get('catalog');
    if (!modulePath)
        throw new Error('--catalog <module.mjs exporting `catalog`> is required');
    const resolved = resolve(modulePath);
    const imported = (await import(pathToFileURL(resolved).href));
    if (!imported.catalog)
        throw new Error(`${modulePath} does not export \`catalog\``);
    const catalogDir = resolve(flags.named.get('catalog-dir') ?? resolve(resolved, '..'));
    return { catalog: defineCatalog(imported.catalog), catalogDir };
}
const USAGE = `journeys <command>

  rehearse    --catalog <module>                      print the watermarked rehearsal script
  verify      --catalog <module> --run <dir>          verify one run attempt against the declaration
  promote     --catalog <module> --run <dir> --run-id <id> --latest <path>
  walkthrough --catalog <module> --out-root <dir> --env <name> --profile <name> --dest <dir>
              [--allow-mixed-app-revision]

  --catalog-dir <dir>   directory whose files form the declaration digest
                        (default: the catalog module's directory)
`;
export async function main(argv) {
    const [command, ...rest] = argv;
    const flags = parseArgs(rest);
    try {
        switch (command) {
            case 'rehearse': {
                const { catalog } = await loadCatalog(flags);
                process.stdout.write(`${buildRehearsal(catalog)}\n`);
                return 0;
            }
            case 'verify': {
                const { catalog, catalogDir } = await loadCatalog(flags);
                const runDirectory = flags.named.get('run');
                if (!runDirectory)
                    throw new Error('--run <attempt directory> is required');
                const manifest = readRunManifest(runDirectory);
                const issues = verifyRun(catalog, manifest, runDirectory, {
                    currentDigest: digestDirectory(catalogDir),
                });
                if (issues.length > 0) {
                    process.stderr.write(`run fails verification:\n- ${issues.join('\n- ')}\n`);
                    return 1;
                }
                process.stdout.write(`run verifies against the declaration (${manifest.journey})\n`);
                return 0;
            }
            case 'promote': {
                const { catalog, catalogDir } = await loadCatalog(flags);
                const runDirectory = flags.named.get('run');
                const latestPath = flags.named.get('latest');
                if (!runDirectory || !latestPath) {
                    throw new Error('--run <attempt directory> and --latest <path> are required');
                }
                const manifest = readRunManifest(runDirectory);
                promoteRun(catalog, manifest, runDirectory, {
                    currentDigest: digestDirectory(catalogDir),
                    runId: flags.named.get('run-id') ?? basename(runDirectory),
                    latestPath,
                });
                process.stdout.write(`promoted ${manifest.journey} (${basename(runDirectory)})\n`);
                return 0;
            }
            case 'walkthrough': {
                const { catalog, catalogDir } = await loadCatalog(flags);
                const outRoot = flags.named.get('out-root');
                const environment = flags.named.get('env');
                const profileName = flags.named.get('profile');
                const destination = flags.named.get('dest');
                if (!outRoot || !environment || !profileName || !destination) {
                    throw new Error('--out-root, --env, --profile and --dest are required');
                }
                const { written, missing } = buildWalkthrough(catalog, {
                    outRoot,
                    environment,
                    profileName,
                    destination,
                    currentDigest: digestDirectory(catalogDir),
                    allowMixedAppRevision: flags.bare.has('allow-mixed-app-revision'),
                });
                for (const entry of missing)
                    process.stderr.write(`missing: ${entry}\n`);
                process.stdout.write(`${written}\n`);
                return missing.length > 0 ? 1 : 0;
            }
            default: {
                process.stderr.write(USAGE);
                return command ? 2 : 0;
            }
        }
    }
    catch (error) {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        return 1;
    }
}
//# sourceMappingURL=main.js.map