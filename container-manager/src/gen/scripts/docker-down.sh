#!/bin/bash

cd "$(dirname "$0")"


compose="docker-compose"
if ! which docker-compose > /dev/null 2>&1; then
  compose="docker compose"
fi

profiles=($($compose config --profiles))

profile="$1"
if [[ -z $profile ]]; then
  if [[ ${#profiles[@]} == 1 ]]; then
    # single machine deployment, nothing to choose between
    profile="${profiles[0]}"
  else
    echo "Missing argument"
    echo "Usage: docker-down.sh PROFILE"
    echo "Profile:"
    if [[ ${#profiles[@]} == 0 ]]; then
      echo "  no profile found in docker-compose.yml"
    else
      echo "  ${profiles[*]} (as defined in docker-compose.yml)"
    fi
    exit
  fi
fi

$compose --profile $profile down

