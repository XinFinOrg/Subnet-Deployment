#!/bin/bash

cd "$(dirname "$0")"

compose="docker-compose"
if ! which docker-compose > /dev/null 2>&1; then
  compose="docker compose"
fi

profiles=($($compose config --profiles))

# the chainspec pre-check needs docker to pull and run the generator image; on a
# host without that reach, or when the mismatch is known and deliberate, it can
# be waived with --bypass
bypass=false

profile=""
for arg in "$@"; do
  case "$arg" in
    --bypass)
      bypass=true
      ;;
    -*)
      echo "Unknown option: $arg"
      echo "Usage: docker-up.sh [--bypass] PROFILE"
      exit 1
      ;;
    *)
      profile="$arg"
      ;;
  esac
done

if [[ -z $profile ]]; then
  if [[ ${#profiles[@]} == 1 ]]; then
    # single machine deployment, nothing to choose between
    profile="${profiles[0]}"
  else
    echo "Missing argument"
    echo "Usage: docker-up.sh [--bypass] PROFILE"
    echo "Profile:"
    if [[ ${#profiles[@]} == 0 ]]; then
      echo "  no profile found in docker-compose.yml"
    else
      echo "  ${profiles[*]} (as defined in docker-compose.yml)"
    fi
    exit
  fi
fi

network_name="docker_net"
if ! docker network inspect "$network_name" > /dev/null 2>&1; then
  echo "Network '$network_name' does not exist. Creating it..."
  docker network create --subnet 192.168.25.0/24 "$network_name"
else
  echo "Joining existing network '$network_name'"
fi


# pre-check: chainspec.json must still match genesis.json, otherwise the
# Nethermind nodes boot on a different config than the XDC nodes.
if [[ $bypass == true ]]; then
  echo "Bypassing chainspec pre-check; chainspec.json is not verified against genesis.json."
else
  bash scripts/check-chainspec.sh
  check_result=$?
  if [[ $check_result == 3 ]]; then
    echo ""
    echo "chainspec.json was updated and the old copy saved as backup in archive directory."
    echo "Run the previous command again to start the chain!"
    exit 1
  elif [[ $check_result != 0 ]]; then
    echo ""
    echo "chainspec pre-check failed, not booting."
    echo "Re-run with --bypass to boot anyway."
    exit $check_result
  fi
fi


$compose --profile $profile pull
$compose --profile $profile up -d

