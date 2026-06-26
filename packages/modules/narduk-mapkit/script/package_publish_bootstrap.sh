#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
POLL_LABEL="com.narduk.mapkit.package-publish"
POLL_PLIST="$HOME/Library/LaunchAgents/$POLL_LABEL.plist"
SOURCE_POLL_PLIST="$ROOT_DIR/Config/$POLL_LABEL.plist"
DEPLOY_LOG_DIR="$HOME/Library/Application Support/NardukMapKit/deploy/Logs"

usage() {
  cat >&2 <<'EOF'
usage: script/package_publish_bootstrap.sh [--help]

Installs or refreshes the local narduk-mapkit package publish poller. The poller
builds from a separate throwaway clone and writes package tarballs under:
  ~/Library/Application Support/NardukMapKit/packages
EOF
}

while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --help|-h) usage; exit 0 ;;
    *) echo "unknown argument: $1" >&2; usage; exit 2 ;;
  esac
done

[[ -f "$SOURCE_POLL_PLIST" ]] || { echo "missing $SOURCE_POLL_PLIST" >&2; exit 1; }

mkdir -p "$(dirname "$POLL_PLIST")" "$DEPLOY_LOG_DIR"
install -m 644 "$SOURCE_POLL_PLIST" "$POLL_PLIST"
launchctl bootout "gui/$(id -u)/$POLL_LABEL" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$(id -u)" "$POLL_PLIST"
launchctl kickstart -k "gui/$(id -u)/$POLL_LABEL" >/dev/null 2>&1 || true

echo "narduk-mapkit package publish poller installed and kicked: $POLL_LABEL"
echo "logs: $DEPLOY_LOG_DIR/package-publish.{out,err}.log"
