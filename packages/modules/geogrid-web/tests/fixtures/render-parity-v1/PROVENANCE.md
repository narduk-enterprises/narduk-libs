# Provenance — `render-parity-v1`

This directory is a **verbatim vendored copy**, not a fixture generated in this
repository. Every byte here (except this file) originates from
`narduk-enterprises/narduk-data`.

| | |
| --- | --- |
| Source repo | `narduk-enterprises/narduk-data` |
| Source commit | `37af845` (`docs(render-parity): document the tile geometry and alpha rules a port needs`, #311) |
| Source path | `fixtures/render-parity-v1/` |
| Vendored on | 2026-08-29 |
| `manifest.json` sha256 | `6251eb34e7ebfbe0765bb536b4cad5525c66cdfb920650920f25f98331530d0c` |

`manifest.json`'s own `files` map pins the SHA-256 and byte length of the
other 16 pack files (grids, expected PNGs, the ramp fixture, and the catalog
excerpt); `tests/render-parity-manifest.test.ts` asserts every one of them
against that map on every test run, so an edited or corrupted vendored file
fails CI rather than silently drifting. `manifest.json` and this
`PROVENANCE.md` are the only two files in this directory that are not
themselves manifest-pinned — nothing can hash itself, and neither should a
provenance note or the manifest invalidate the data pin it describes.

**Note on the commit bump from `0ddddcb` to `37af845`:** this pack was
originally vendored at `0ddddcb`. narduk-data PR #311 (merged as `37af845`)
then added ~85 lines to the pack's own `README.md` — the tile-latitude
linear-interpolation rule with its measured divergence table, the
alpha-from-ramp-not-coverage rule (including the indexed-PNG/`tRNS` decoder
notes this repo's `tests/support/png.ts` had already independently worked
out and verified), and a four-item consumer Tier-1 checklist — **and
touched nothing else** in `fixtures/render-parity-v1/`. Verified directly
against the upstream repository: `git diff --stat 0ddddcb 37af845 --
fixtures/render-parity-v1/` shows only `README.md` changed, and
`manifest.json`'s sha256 at `37af845` is identical to the one recorded
above. All 16 manifest-pinned files, and therefore every test in this
repository that reads them, are unaffected by this bump — only the
(deliberately unpinned) documentation moved.

To re-vendor after narduk-data publishes a new commit of this pack, run
`tests/fixtures/vendor_render_parity.mjs` (see that script for usage) and
update the source commit and `manifest.json` sha256 above by hand — like the
other regeneration scripts beside it, running it is a deliberate local act,
not a CI step, and the diff it produces should be reviewed rather than
rubber-stamped. (This particular README bump was applied by extracting
`README.md` directly from the `37af845` commit rather than by running the
script, because the local narduk-data checkout used for this vendoring had
not yet fast-forwarded its working tree to that commit; the script itself
always copies from whatever is on disk at `$NARDUK_DATA_ROOT`, not from a
specific commit.)

## The provenance-line normalization

`ramp-parity-v1.json` in this pack began life as a working draft at
`tests/fixtures/ramp-parity-v1.json` in **this** repository (GeoGridWeb),
generated locally by `tests/fixtures/generate_ramp_parity.py` before
narduk-data adopted the same schema as its own canonical
`fixtures/render-parity-v1/` pack. The two files differ in **exactly one
line** — the `generator` field, which correctly names whichever script
produced that particular copy:

| | `generator` value | file sha256 |
| --- | --- | --- |
| GeoGridWeb's retired draft | `tests/fixtures/generate_ramp_parity.py` | `3537756f08b5bef9ca658e56443735874cc94509e1cf8445f560e4c00a1de6c1` |
| narduk-data's canonical copy (vendored here) | `scripts/generate_render_parity_fixtures.py` | `564f1eb37a24967db782490950e42161bcdbb1c42af08b4661bb5e28823d68a1` |

Verified during the 2026-08-29 vendoring: parsing both files as JSON, deleting
the `generator` key from each, and re-serializing yields **byte-identical**
objects. Stripping that one line and hashing what remains gives the same
digest for both files —

```
f63736b97323a67ad633e3f9e592fd057848cbab14a4ea3138f5e068a7cc6ba2
```

— which means every ramp stop, every sample, every normalized value, every
LUT byte, and both LUT digests are identical between the draft and the
canonical pack. `tests/color-parity.test.ts` needed only a path change (to
`tests/fixtures/render-parity-v1/ramp-parity-v1.json`) to consume the
canonical copy; no assertion in that file changed.

The retired draft (`tests/fixtures/ramp-parity-v1.json` and
`tests/fixtures/generate_ramp_parity.py`) has been deleted from this
repository. narduk-data's `fixtures/render-parity-v1/` — vendored here — is
now the single upstream source for this fixture across all three consuming
repositories (narduk-data, GeoGridKit, GeoGridWeb).
