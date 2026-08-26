#!/usr/bin/env bash

set -euo pipefail

readonly release_pipeline_id='01a03ef8-ed3e-4cc7-84a9-ff5ab271a372'

if [[ "${BUILDKITE_PIPELINE_ID:-}" != "${release_pipeline_id}" ]]; then
  printf 'Package publication is restricted to the narduk-libs pipeline.\n' >&2
  exit 1
fi

if [[ "${BUILDKITE_BRANCH:-}" != 'main' ]]; then
  printf 'Package publication is restricted to main.\n' >&2
  exit 1
fi

if [[ "${RELEASE_PUBLISH:-}" != 'true' ]]; then
  printf 'Package publication requires RELEASE_PUBLISH=true.\n' >&2
  exit 1
fi

if [[ ! "${BUILDKITE_COMMIT:-}" =~ ^[0-9a-f]{40}$ ]]; then
  printf 'BUILDKITE_COMMIT must be a full Git commit SHA.\n' >&2
  exit 1
fi

checkout_sha="$(git rev-parse HEAD)"
readonly checkout_sha
if [[ "${checkout_sha}" != "${BUILDKITE_COMMIT}" ]]; then
  printf 'Checked-out SHA does not match BUILDKITE_COMMIT.\n' >&2
  exit 1
fi

remote_main_sha="$(git ls-remote origin refs/heads/main | cut -f1)"
readonly remote_main_sha
if [[ "${remote_main_sha}" != "${BUILDKITE_COMMIT}" ]]; then
  printf 'A newer main SHA exists; refusing to publish from a stale build.\n' >&2
  exit 1
fi

if find .changeset -maxdepth 1 -type f -name '*.md' ! -name README.md | grep -q .; then
  printf 'Unconsumed changesets remain; merge the version PR before publishing.\n' >&2
  exit 1
fi

pnpm run versions:check
pnpm run release:publish
pnpm run release:verify-published

printf 'Published and consumer-verified narduk-libs release at %s.\n' "${BUILDKITE_COMMIT}"
