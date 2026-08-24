#!/bin/bash
# Pre-boot check: verify chainspec.json still describes the same chain as
# genesis.json. Run this before docker-up.sh — a stale chainspec gives the
# Nethermind nodes a different config than the XDC nodes, and they will never
# sync with each other.
#
# If they differ, the old chainspec.json is moved to archive/ under a UTC
# timestamp and replaced with the one genesis.json translates to.
#
# Usage: ./scripts/check-chainspec.sh [genesis.json] [chainspec.json] [--dry-run]
#   paths are relative to the deployment folder (the parent of this script)
#   --dry-run reports the differences without changing any file
#
# Exit code: 0 already matched, 3 differed, 2 error.
#
# The check runs in a throwaway subnet-generator container, which carries the
# converter; the host needs docker only. The image defaults to the generator
# that produced this deployment, recorded in gen.env at generation time; export
# GENERATOR_IMAGE_VERSION to override it.

cd "$(dirname "$0")/.."

if [[ -z "$GENERATOR_IMAGE_VERSION" && -f gen.env ]]; then
  GENERATOR_IMAGE_VERSION=$(grep -E '^GENERATOR_IMAGE_VERSION=' gen.env | tail -1 | cut -d '=' -f 2-)
fi
if [[ -z "$GENERATOR_IMAGE_VERSION" ]]; then
  echo "Error: GENERATOR_IMAGE_VERSION is not set and gen.env does not record one"
  echo "Export it to pick the subnet-generator image to run the check with."
  exit 2
fi

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

if [[ ! -f "$genesis" ]]; then
  echo "Error: $genesis not found in $PWD"
  exit 2
fi

if [[ ! -f "$chainspec" ]]; then
  echo "Error: $chainspec not found in $PWD"
  echo "It is generated from $genesis when the deployment is generated."
  exit 2
fi

# a local copy of the tag can be outdated and docker will not re-pull it on
# its own; if the pull fails, fall through and use whatever is local
docker pull "$GENERATOR_IMAGE_VERSION"

# -u keeps the archived and rewritten files owned by the invoking user
docker run --rm -u "$(id -u):$(id -g)" -v "$PWD:/data" -w /data "$GENERATOR_IMAGE_VERSION" \
  node /app/libs/check-chainspec.js "$genesis" "$chainspec" "$@"
result=$?

# only 0, 2 and 3 come from the check itself; anything else is docker or node
# failing before it could compare, and must not be read as a result
if [[ $result != 0 && $result != 2 && $result != 3 ]]; then
  exit 2
fi
exit $result
