#!/usr/bin/env bash

set -euo pipefail

readonly node_version='22.22.3'

case "$(uname -m)" in
  x86_64 | amd64)
    readonly node_arch='x64'
    readonly node_sha256='2e5d13569282d016861fae7c8f935e741693c269101a5bebcf761a5376d1f99f'
    ;;
  aarch64 | arm64)
    readonly node_arch='arm64'
    readonly node_sha256='1c4a9933a5e45bc88f54f70b5f91232c127ec49f1a5989d23fb85824c7adf9b7'
    ;;
  *)
    printf 'Unsupported Buildkite architecture: %s\n' "$(uname -m)" >&2
    return 1
    ;;
esac

readonly node_archive="node-v${node_version}-linux-${node_arch}.tar.xz"
readonly node_dir="${HOME}/.local/node-${node_version}"

if [[ ! -x "${node_dir}/bin/node" ]]; then
  download_dir="$(mktemp -d)"
  readonly download_dir
  curl --fail --silent --show-error --location \
    "https://nodejs.org/dist/v${node_version}/${node_archive}" \
    --output "${download_dir}/${node_archive}"
  (
    cd "${download_dir}"
    printf '%s  %s\n' "${node_sha256}" "${node_archive}" | sha256sum --check
  )
  mkdir -p "${node_dir}"
  tar -xJ -C "${node_dir}" --strip-components=1 -f "${download_dir}/${node_archive}"
fi

export PATH="${node_dir}/bin:${HOME}/.local/bin:${PATH}"

[[ "$(node --version)" == "v${node_version}" ]]
npm install --global --prefix "${HOME}/.local" pnpm@10.33.4
[[ "$(pnpm --version)" == '10.33.4' ]]
