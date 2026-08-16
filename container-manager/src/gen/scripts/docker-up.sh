#!/bin/bash

cd "$(dirname "$0")"

if [[ -z $1 ]]; then
  echo "Missing argument"
  echo "Usage: docker-up.sh PROFILE"
  echo "Profile:"
  echo "  machine1, machine2, ... (as defined in docker-compose.yml)"
  exit
fi

which docker-compose
if [[ $? != 0 ]]; then
    shopt -s expand_aliases
    alias docker-compose='docker compose'
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
  exit $check_result
fi


docker-compose --profile $1 pull
docker-compose --profile $1 up -d

