# Ponytail 5 audit: narduk-app-tools tests, docs, fixtures, fonts

What this repo does: `@narduk-enterprises/narduk-app-tools` is the published `narduk-app` CLI. One Nuxt app runs it on its own checkout for local dev, D1 migrations, Wrangler deploys, ship and rollback, live proof, and the foundation checks. This lane is `tests/`, `docs/`, `fixtures/`, and `fonts/` only.

Load I assumed: Fleet apps install the npm package and run the CLI from CI and from a workstation, one app at a time. It is not a high-QPS service. A bad release reaches every app that upgrades. `tests/` run in this repo's CI and are not in the tarball. `docs/` and `fonts/` are in the tarball (`package.json` `files`). `fixtures/` are not published; they pin this package's tests and `create-narduk-app`. I audited `origin/main` at `212392aa`. I did not run the suite.

## Must fix

### 1. tests/ship.test.ts:450-457 — a refused `ship -m` still creates the commit

What this is: `docs/ship.md:15-18` says `-m` commits the dirty tree, untracked files included, only once the checks that need no build have passed. `--dry-run` does not commit. `tests/ship.test.ts:450-457` is the case where a new migration file must be refused.

Problem: The commit runs first. `src/ship.ts:430-432` does `git add --all` and `git commit` as soon as the dry-run return has passed. The token check (`src/ship.ts:440`), the check that HEAD contains the commit production serves (`src/ship.ts:504-508`), and the migration-file refusal (`src/ship.ts:526-529`) all run after that commit. Concrete case: a feature branch with an untracked `apps/web/migrations/0002.sql`, and `narduk-app ship --no-pr -m migrate`, with migrations declared. The test expects exit 1, the log line `Migration files changed`, and no upload. Those assertions pass. HEAD still moves. The new SQL is now a commit on the branch. The same order commits a dirty tree and then refuses when `CLOUDFLARE_API_TOKEN` is unset (`src/ship.ts:440`). Exit 1 means "production unchanged" (`docs/ship.md:52`). The local branch has a new commit, including every untracked file `git add --all` saw. The behavior lives in `src/ship.ts` (other lane). This lane's test does not look at HEAD.

Fix: Move the add and commit to after the token check, the served-commit check, and the migration diff. In `tests/ship.test.ts:450-457`, assert `git rev-parse HEAD` is unchanged when the command returns refused.

If we skip it: A refused ship leaves a commit the doc says will not exist. The next `git push` publishes untracked files the author had not staged, while the ship log says production was unchanged.

### 2. docs/ship.md:29-30 — an API key in the built JS still uploads

What this is: The artifact gate promises that no credential value in public assets is uploaded. `scanPublicAssetsForSecretLeaks` (`src/ship-support.ts:183-196`) finds a string of length 8 or more in `.css`, `.js`, `.json`, `.html`, and a few other text files. `tests/ship-support.test.ts:34-54` covers that scanner when the caller passes the secret in. `src/ship.ts:559-565` decides which environment values are secrets.

Problem: The filter is `/TOKEN|SECRET|PASSWORD|GH_PACKAGES_READ/`. `CLOUDFLARE_API_KEY` and `CF_API_KEY` do not match. Concrete case: the workstation environment has `CLOUDFLARE_API_KEY` set to a 16-character global API key, and `.output/public/app.js` contains that exact string. `runShip` still uploads. `CLOUDFLARE_API_TOKEN` in the same file is refused. No test builds that pair. The regex lives in `src/ship.ts` (other lane). The doc in this lane states the wider promise, and the tests never lock the key list.

Fix: Add `API_KEY` to that filter. Add one ship test: a public `.js` file that contains the `CLOUDFLARE_API_KEY` value returns refused, and `upload` is not called.

If we skip it: A global API key baked into a client bundle ships. The gate was added to stop that, and it only sees names that contain TOKEN, SECRET, or PASSWORD.

## Should fix

### 3. docs/ship.md:19-24 — ship fetches, including on `--dry-run`

What this is: Step 2 says local git answers first, GitHub answers otherwise, and nothing is fetched into the clone. `tests/ship.test.ts:292-310` locks "never fetches" for `resolveContainment` only.

Problem: `runShip` runs `git fetch --quiet --no-tags origin <productionBranch>` at `src/ship.ts:413`, with the caller's credentials, before the dry-run return at `src/ship.ts:424`. Concrete case: `narduk-app ship --dry-run` on a laptop whose `origin` fetch fails (offline, or a credential helper error). The command throws `git fetch failed: ...`. The CLI prints that and exits 1 (`src/cli.ts:607-609`). It does not print the dry-run plan. A second fetch, `git fetch origin <served sha>`, runs at `src/ship.ts:517` when the app declares migrations, after the `-m` commit from finding 1. `resolveContainment` itself does not fetch. The `runShip` fetches have no test. The fetch calls live in `src/ship.ts` (other lane).

Fix: Say in `docs/ship.md:19-24` that ship fetches `origin/<productionBranch>` first, and that a migration app also fetches the served SHA. Keep the sentence that the GitHub containment lookup does not fetch objects. Add one test that a dry run invokes that production-branch fetch and still does not commit.

If we skip it: An operator trusts the doc, runs a dry run offline, and gets a fetch failure instead of the plan. A failed fetch after `-m` also leaves the commit from finding 1.

### 4. docs/preview-isolation.md:30-33 — the preview redirect file is unnamed

What this is: The doc says a non-production `versions-upload` writes `.wrangler.deploy.preview.json` and uploads with it. `tests/preview-config.test.ts:223-231` also asserts `.wrangler/deploy/config.json` points at that file (`configPath: ../../.wrangler.deploy.preview.json`).

Problem: `selectDeployConfig` writes that redirect (`src/deploy.ts:395-397`). Wrangler reads it whenever a later command has no `--config` (`src/deploy.ts:241-243`). The package's own upload passes `--config`, so that one command is fine. Concrete case: a checkout where `WORKERS_CI_BRANCH` is a feature branch and preview bindings are complete. After `versions-upload`, someone runs `wrangler d1 execute DB --remote` in that directory with no `--config`. Wrangler follows the redirect and uses the preview database id. `docs/preview-isolation.md` never names `.wrangler/deploy/config.json`. The write lives in `src/deploy.ts` (other lane). The missing sentence is in this doc.

Fix: Add one sentence: the build also writes `.wrangler/deploy/config.json`, and a later wrangler command without `--config` follows it. Point at the existing test.

If we skip it: A follow-up remote D1 command in that checkout reads and writes the preview database while the operator is looking at `wrangler.jsonc`.

### 5. tests/commands.test.ts:203-216 — a huge brand font passes the budget

What this is: The only behavioral test of `performance-budget` is an empty `.output/public`. It expects exit 1 because CSS is missing. `docs/brand-assets.md:69` and `:98-107` tell every app to commit `public/fonts/brand-display.ttf` and to serve it to the browser.

Problem: `runPerformanceBudgetCheck` counts a font only when the path starts with `.output/public/_fonts/` (`src/performance.ts:126-129`). It does not count `public/fonts/` or `.output/public/fonts/`. A missing font is a warning, and warnings do not change the exit code (`src/performance.ts:289-294`). Concrete case: `public/fonts/brand-display.ttf` is 2_000_000 bytes, and `.output/public/app.css` is 10 bytes. Violations is empty. The CLI exits 0. The same file copied to `.output/public/fonts/brand-display.ttf` by the Nuxt build is still ignored. No test puts a file under `_fonts` either, so deleting the font size check also leaves the suite green. The check lives in `src/performance.ts` (other lane).

Fix: Count `public/fonts` and `.output/public/fonts` as fonts. Add one test: a `.woff2` over the per-file budget fails, and a file under the budget passes.

If we skip it: The font the brand guide tells apps to ship is invisible to the budget. A multi-megabyte face exits 0 as long as some small CSS file exists.

### 6. fonts/README.md:9-11 — published faces are not locked, and the weight column disagrees with the files

What this is: The three `.ttf` files ship in the npm package. The card renderer asks for family plus weight 400 (`src/brand/render.ts:40-42`, other lane). `tests/brand-font.test.ts:145` checks one fact: the display file's family is `NE Brand Display`.

Problem: I read each file's `name` and `OS/2` tables. All three declare subfamily Regular and `usWeightClass` 400. They are not variable fonts. The STAT names still say ExtraBold and 96pt (display), Medium and 14pt (text), and Bold (mono), which is the instance column in the README (wght 800, 500, and 700). Concrete case: replace `ne-brand-text.ttf` and `ne-brand-mono.ttf` with copies of `ne-brand-display.ttf`. `brand-font.test.ts` still passes. `brand-assets.test.ts` still writes an `og.png` and checks the image size, not the face. `bundledFace('text')` asks for `NE Brand Text`, the file now says `NE Brand Display`, and fontconfig substitutes. A regen that sets `usWeightClass` to 800 to match the README also passes the test, while the renderer still asks for 400.

Fix: In the README, keep the upstream instance (ExtraBold / Medium / Bold) and add the declared face: Regular, weight 400. Assert `readFontInfo` on all three `brandFontFile` roles: the `NE Brand *` family, weight 400, italic false, `variable` false.

If we skip it: A bad replace of the text or mono file ships, and every app's share card typesets with a substituted face. The weight column keeps telling the next editor the file is 800 while the bytes say 400.

### 7. tests/ship.test.ts:356-380 — ship exits 4 and 5 have no test

What this is: `docs/ship.md:49-55` is the contract an agent branches on. Exit 3 means the previous version serves again. Exit 4 means the new version serves and the PR step failed. Exit 5 means the proof failed and the rollback did not take. `src/ship.ts:618-660` implements 4 and 5. The tests cover a failed proof and a failed promote that then roll back cleanly (exit 3).

Problem: Nothing makes the second `deployVersion` throw, and nothing makes `gh` throw after a green proof. Concrete case: promote of the new version succeeds, verify returns `FAIL`, and the rollback `deployVersion` throws. The correct result is exit 5 and a log line `deploy rollback --to <previous id>`. If that catch returns exit 1 or exit 3, `tests/ship.test.ts` stays green. Exit 1 means production was unchanged (`docs/ship.md:52`). Exit 3 means the previous version serves. The new version can still be the one serving. The PR case is the same shape: proof passes, `gh pr create` throws, the correct exit is 4. An exit 0 means the doc's "PR armed" row, and `versions-promote` will then refuse main commits until someone merges by hand (`docs/ship.md:41-47`).

Fix: Two tests. Second `deployVersion` throws, expect `SHIP_EXIT.rollbackFailed` and the printed `--to` id. `gh` throws after a passing proof, expect `SHIP_EXIT.prFailed`, and expect the upload to have happened.

If we skip it: A rollback that did not stick is reported as a clean refusal or a clean rollback. The person on call stops. Production is on the version that just failed proof.

## Nice to have

### 8. tests/foundation/item-4-no-forks.test.ts:49-57 — the pinned fork hash is thrown away

What this is: The 4.2 test builds a one-entry fork list so a known file hash fails the check.

Problem: Lines 49-51 say the literal `f3b1f5f0…` is the pinned sha256 of the fixture content. Line 57 overwrites `seededForkList[0].sha256` with `normalizedContentHash(forkedContent)` before the check runs. The literal is never read. Concrete case: delete line 57 and the test compares the file to a hash that is not the content's hash, so that exact file passes 4.2.

Fix: Set `sha256` to `normalizedContentHash(forkedContent)` in the object. Delete the literal and the two comments that call it pinned.

If we skip it: The next edit trusts the comment, drops the overwrite, and 4.2 goes green for the fixture it claims to catch.

## Smaller notes left out

Six, all weaker than the list above.

- `docs/brand-assets.md` images live under the repo's `docs/images/`. They render on GitHub. They are not in the npm `files` list, so the same links break inside `node_modules`.
- The Bricolage files are missing U+00A4 and U+00AD. The README says Latin-1. The card character `·` is present. I checked the cmap.
- `assessHealth` does not read the HTTP status. A 503 whose body says `status: ok` passes. narduk-core pairs 503 with a non-ok envelope, and no test covers a disagreement. The function is in `src/verify-live.ts` (other lane).
- `docs/e2e-serve.md:109-111` says a following `ECONNREFUSED` must still print. The filter test never feeds that line. A plain `ECONNREFUSED` line is kept by the current code.
- `docs/workers-cache.md:108` says 12.7 `unknown` means the core spec names no version. The check also returns `unknown` when cache is on and no `package.json` depends on narduk-core (`src/foundation/items/item-12-deployment-standard.ts:1266-1273`, other lane).
- `filesUnder` in `src/dev-seed.ts` follows symlinks while collecting local R2 files. The seed is local and the credentials are stripped. No test covers a symlink that points outside the fixture dir.

Verdict: The migration runner, live proof, and foundation suites I traced do lock the dangerous edges, and the fixtures match the checkers that read them. Do not ship the next app-tools release on this tree until finding 1 and finding 2 are fixed. A refused `ship -m` creates a commit, and a Cloudflare API key in the client bundle is not a failed artifact gate.

Lean: -4 lines, -0 dependencies possible.

Not checked: I did not run the tests. I did not read every line of `tests/promote.test.ts` (2289), `tests/verify-live.test.ts` (838), `tests/staging.test.ts`, `tests/migrations-runtime.test.ts` past the case list, or the largest foundation files (`item-12` test, `nac-status`, `adoption`, `npm-registry`, `item-9`, `item-11`). I used those files to confirm a specific claim. `src/` is another lane. I opened it only to see whether a test or a doc sentence is true. I did not audit the package README past the command map, the changelog, or any other package. The opt-in live npm registry test and real DNS were not executed. Font outlines were checked through `name`, `OS/2`, STAT name ids, and cmap, not by rendering a card.
