#!/bin/sh
set -eu

usage() {
  echo "Usage: $0 <generated-file> [<generated-file> ...] -- <command> [args...]" >&2
  exit 1
}

[ "$#" -ge 3 ] || usage

targets=''

while [ "$#" -gt 0 ]; do
  if [ "$1" = "--" ]; then
    shift
    break
  fi

  targets="$targets $1"
  shift
done

[ -n "$targets" ] || usage
[ "$#" -gt 0 ] || usage

generated_file_is_current() {
  target="$1"

  if [ ! -f "$target" ]; then
    return 1
  fi

  target_dir=$(dirname "$target")

  for import_path in $(sed -n \
    -e "s/.*from ['\"]\([^'\"]*node_modules\/.pnpm\/[^'\"]*\)['\"].*/\1/p" \
    -e "s/^import ['\"]\([^'\"]*node_modules\/.pnpm\/[^'\"]*\)['\"].*/\1/p" \
    "$target"); do
    if [ ! -e "$target_dir/$import_path" ]; then
      return 1
    fi
  done

  return 0
}

all_current() {
  for target in $targets; do
    if ! generated_file_is_current "$target"; then
      return 1
    fi
  done

  return 0
}

if ! all_current; then
  "$@"
fi

attempt=0
while ! all_current; do
  attempt=$((attempt + 1))

  if [ "$attempt" -ge 5 ]; then
    echo "Expected generated file(s) missing or stale after: $*" >&2
    for target in $targets; do
      if ! generated_file_is_current "$target"; then
        echo "Missing or stale: $target" >&2
      fi
    done
    exit 1
  fi

  sleep 1
done
