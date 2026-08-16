#!/bin/bash
# Pre-boot check: verify chainspec.json still describes the same chain as
# genesis.json. Run this before docker-up.sh — a stale chainspec gives the
# Nethermind nodes a different genesis block than the XDC nodes, and they
# will never sync with each other.
#
# If they differ, the old chainspec.json is moved to archive/ under a UTC
# timestamp and replaced with the one genesis.json translates to.
#
# Usage: ./check-chainspec.sh [genesis.json] [chainspec.json] [--dry-run]
#   paths are relative to this deployment folder
#   --dry-run reports the differences without changing any file
#
# Exit code: 0 already matched, 1 differed, 2 error.
#
# Uses the host's node when it has one, otherwise runs the check in a
# throwaway container ($CHECK_IMAGE, default node:24-alpine).

cd "$(dirname "$0")"

genesis="genesis.json"
chainspec="chainspec.json"
if [[ -n "$1" && "$1" != -* ]]; then
  genesis="$1"
  shift
  if [[ -n "$1" && "$1" != -* ]]; then
    chainspec="$1"
    shift
  fi
fi
image="${CHECK_IMAGE:-node:24-alpine}"

if [[ ! -f "$genesis" ]]; then
  echo "Error: $genesis not found in $PWD"
  exit 2
fi

if [[ ! -f "$chainspec" ]]; then
  echo "Error: $chainspec not found in $PWD"
  echo "It is generated from $genesis when the deployment is generated."
  exit 2
fi

if command -v node > /dev/null 2>&1; then
  node scripts/check-chainspec.js "$genesis" "$chainspec" "$@"
else
  # -u keeps the archived and rewritten files owned by the invoking user
  docker run --rm -u "$(id -u):$(id -g)" -v "$PWD:/data" -w /data "$image" \
    node scripts/check-chainspec.js "$genesis" "$chainspec" "$@"
fi
