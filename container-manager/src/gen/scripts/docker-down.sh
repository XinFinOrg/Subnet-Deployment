#!/bin/bash

cd "$(dirname "$0")"


if [[ -z $1 ]]; then
  echo "Missing argument"
  echo "Usage: docker-down.sh PROFILE"
  echo "Profile:"
  echo "  machine1, machine2, ... (as defined in docker-compose.yml)"
  exit
fi

which docker-compose
if [[ $? != 0 ]]; then
    shopt -s expand_aliases
    alias docker-compose='docker compose'
fi

docker-compose --profile $1 down

