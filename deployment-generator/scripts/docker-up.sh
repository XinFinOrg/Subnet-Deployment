#!/bin/bash

cd "$(dirname "$0")"

if [[ -z $1 ]]; then
  echo "Missing argument"
  echo "Usage: docker-up.sh PROFILE"
  echo "Profile:"
  echo "  machine1 - subnet nodes"
  echo "  services - relayer, backend, frontend"
  exit
fi

docker compose --env-file --profile $1 pull
docker compose --env-file --profile $1 up -d

