#!/usr/bin/env bash

set -euo pipefail

export NPM_CONFIG_USERCONFIG="${PWD}/.npmrc.auth"
export NPM_CONFIG_GLOBALCONFIG='/dev/null'

node scripts/package-registry-auth.mjs

cleanup_registry_auth() {
  rm -f "${NPM_CONFIG_USERCONFIG}"
}

trap cleanup_registry_auth EXIT
