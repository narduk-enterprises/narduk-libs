# Local and CI recipe for NardukMusic work

Apple builds are the scarce resource: CI runs the macOS job on a GitHub-hosted `macos-26` runner (queue
44 s to 705 s in the 2026-10-07 sample), and local `xcodebuild` and simulator runs share one laptop. Put work
on Linux whenever the code allows.

## What CI runs for a pull request

`scripts/narduk-music-ci-plan.mjs` places the diff. Linux is always the full gate for the modules it builds.
The macOS job and its steps run only when the diff can change them; a push to `main`, a release and anything
the planner cannot place run every step.

| Diff touches | macOS job | iOS device loop | SoundGallery | Beat Blaster |
| --- | --- | --- | --- | --- |
| Only `*.md` or `docs/` under narduk-music | skipped | skipped | skipped | skipped |
| Only Core, DSP, Render, the CLI or their tests | swift-quality + consumer | skipped | skipped | skipped |
| `NardukSonify`, `NardukSoundAnalysis` | yes | yes | skipped | skipped |
| `NardukMusicEngine`, `NardukSoundVisuals` | yes | yes | yes | yes |
| `Apps/SoundGallery`, `Apps/BeatBlaster` | yes | skipped | gallery only | blaster only |
| `Package.swift`, the music workflow or planner | yes | yes | yes | yes |

A skipped step is covered by the push to `main` after the merge. If your Core change touches something an app
consumes (for example `SongRecipe` used by Beat Blaster), run that app locally before merging.

## Where to test

- **Core, DSP, Render, CLI** (the Linux-buildable products): the Linux job is the gate. Locally,
  `swift test --filter NardukMusicCore` (or DSP/Render) on the laptop is enough; do not run the iOS loop or
  an app build for these.
- **Engine, Analysis, Sonify, Visuals**: `swift test --filter <Target>` locally; Apple frameworks, so macOS only.
- **Apps and simulators**: only when the change touches them, through
  `~/.local/share/agent-infrastructure/skills/apple-release-pipeline/scripts/xcodebuild_leased.sh`, never bare
  `xcodebuild`. Never play audio: render offline to a file.
- **Linux locally** (not verified in this lane): the laptop has the Docker CLI; a `swift` image running
  `python3 packages/modules/narduk-music/swift/scripts/swift-quality.py` mirrors the Linux job.

## What exists for offloading (read 2026-10-07)

- **Linux fleet**: `home-pve01` hosts the general CI guest (four slots) and `fsn1-pve02` is CI-only
  (`narduk-enterprises/fleet` `docs/host-inventory.md`). They are runner hosts, not lane dev boxes, and
  narduk-libs is public, so its CI never routes to self-hosted runners (`CI-RUNNER-POLICY.md`). No lane-reachable
  Linux dev box is documented.
- **iMac** (`ssh imac`, iMac Pro, Intel): macOS 15.7.9, Xcode 26.0.1 (Swift 6.2), iOS 26.0 simulator runtime,
  `/Library/Application Support/NardukAppleRunner/bin` present (the build lease `xcodebuild_leased.sh` uses).
  The repo's declared toolchain is Xcode 26.6, so it can run the package and consumer but not match CI's
  compiler exactly. Idle at the time of reading (load ~3).
- **GitHub Codespaces**: nothing in the estate docs; not checked.
