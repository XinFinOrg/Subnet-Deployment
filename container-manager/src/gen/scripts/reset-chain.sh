#!/bin/bash
# Reset the chain: stop the containers, then delete every node's data directory
# (xdcchain*) in this deployment. The next docker-up.sh starts again from
# block 0.
#
# Destructive and not undoable. Keys, genesis.json, chainspec.json and the env
# files are kept -- only the chain data goes -- but every block, every account
# balance and every deployed contract goes with it.
#
# Usage: ./scripts/reset-chain.sh [PROFILE]
#   PROFILE is passed to docker-down.sh / docker compose, and is only needed on
#   a deployment with more than one.

# --------------------------------------------------------------------------
# Locate the deployment, strictly.
#
# This script deletes by glob, so it must be certain which directory it is
# pointed at. The rule: the data directories are always exactly one level above
# this script, i.e. this file lives at <deployment>/scripts/reset-chain.sh and
# deletes <deployment>/xdcchain*. Anything that does not match that shape is
# refused rather than guessed at.
#
# pwd -P resolves symlinks, so the path checked below is the real one.
# --------------------------------------------------------------------------
script_dir=$(cd "$(dirname "$0")" && pwd -P) || exit 2
root=$(dirname "$script_dir")

if [[ $(basename "$script_dir") != "scripts" ]]; then
  echo "Error: this script must live in <deployment>/scripts/, but it is in:"
  echo "  $script_dir"
  echo "Refusing to guess which directory to delete from."
  exit 2
fi

if [[ "$root" == "/" || "$root" == "$HOME" ]]; then
  echo "Error: refusing to operate on $root"
  exit 2
fi

# A generated deployment has both of these. Without them this is not one.
for required in docker-compose.yml genesis.json; do
  if [[ ! -f "$root/$required" ]]; then
    echo "Error: $root/$required not found, so this is not a generated deployment."
    echo "Refusing to delete anything."
    exit 2
  fi
done

cd "$root" || exit 2

banner() {
  local rule="======================================================================"
  echo ""
  echo "$rule"
  printf '  %s\n' "$@"
  echo "$rule"
  echo ""
}

compose="docker-compose"
if ! which docker-compose > /dev/null 2>&1; then
  compose="docker compose"
fi

# --------------------------------------------------------------------------
# Collect the targets. Direct children of $root only: nullglob so an unmatched
# pattern expands to nothing rather than the literal string, real directories
# only, and each one's resolved path must still be inside $root -- a symlinked
# xdcchain* pointing elsewhere is reported and skipped, never followed.
# --------------------------------------------------------------------------
shopt -s nullglob
candidates=(xdcchain*)
shopt -u nullglob

datadirs=()
skipped=()
for d in "${candidates[@]}"; do
  if [[ -L "$d" ]]; then
    skipped+=("$d (symlink)")
    continue
  fi
  if [[ ! -d "$d" ]]; then
    skipped+=("$d (not a directory)")
    continue
  fi
  resolved=$(cd "$d" && pwd -P)
  if [[ "$resolved" != "$root/$d" ]]; then
    skipped+=("$d (resolves outside the deployment: $resolved)")
    continue
  fi
  datadirs+=("$d")
done

if [[ ${#skipped[@]} -gt 0 ]]; then
  echo "Not touching:"
  printf '  %s\n' "${skipped[@]}"
fi

if [[ ${#datadirs[@]} == 0 ]]; then
  echo "No xdcchain* data directories in $root; nothing to reset."
  exit 0
fi

# --------------------------------------------------------------------------
# Identify the chain, so the operator can see which one they are about to wipe.
# grep/sed only: jq and python are not guaranteed on a deployment host.
# --------------------------------------------------------------------------
chain_name=$(grep -E '^NETWORK_NAME=' gen.env 2>/dev/null | tail -1 | cut -d '=' -f 2-)
chain_id=$(grep -oE '"chainId"[[:space:]]*:[[:space:]]*[0-9]+' genesis.json 2>/dev/null \
  | head -1 | grep -oE '[0-9]+$')
spec_name=$(grep -oE '"name"[[:space:]]*:[[:space:]]*"[^"]*"' chainspec.json 2>/dev/null \
  | head -1 | sed -E 's/.*"name"[[:space:]]*:[[:space:]]*"([^"]*)"/\1/')

# Head block, best effort. Node i publishes RPC on 8544+i, so probe one port per
# data directory and take the highest answer. A stopped chain answers nothing,
# which is normal here -- this is a sanity check, not a precondition.
parse_block_number() {
  local raw
  raw=$(printf '%s' "$1" \
    | grep -oiE '"(number|result)"[[:space:]]*:[[:space:]]*"?(0x[0-9a-fA-F]+|[0-9]+)"?' \
    | head -1 | sed -E 's/.*:[[:space:]]*"?//; s/"$//')
  [[ -z "$raw" ]] && return 1
  printf '%d' "$raw" 2>/dev/null || return 1
}

rpc() {
  curl -s -m 3 --location "http://localhost:$1" \
    --header 'Content-Type: application/json' \
    --data "{\"jsonrpc\":\"2.0\",\"method\":\"$2\",\"params\":[],\"id\":1}" 2>/dev/null
}

# Ports are host-wide, so a node answering on 8545 is not necessarily a node of
# THIS deployment -- another chain on the same machine would answer too, and
# reporting its head block here would be actively misleading. Only count a node
# whose eth_chainId matches this genesis, and say so when one does not.
head_block=""
responding=0
foreign=0
for ((i = 1; i <= ${#datadirs[@]}; i++)); do
  port=$((8544 + i))
  node_chain=$(parse_block_number "$(rpc "$port" eth_chainId)") || continue
  if [[ -n "$chain_id" && "$node_chain" != "$chain_id" ]]; then
    foreign=$((foreign + 1))
    continue
  fi
  num=$(parse_block_number "$(rpc "$port" eth_blockNumber)") || continue
  responding=$((responding + 1))
  if [[ -z "$head_block" || "$num" -gt "$head_block" ]]; then
    head_block="$num"
  fi
done

if [[ -n "$head_block" ]]; then
  block_line="$head_block (from $responding node(s) on chain id $chain_id)"
else
  block_line="unknown - no node of this chain answered on 8545-$((8544 + ${#datadirs[@]})), it looks stopped"
fi
if [[ $foreign -gt 0 ]]; then
  block_line="$block_line
               NOTE: $foreign node(s) on those ports belong to a DIFFERENT chain id;
               check you are in the right deployment directory"
fi

# --------------------------------------------------------------------------
# Show exactly what goes, then ask.
# --------------------------------------------------------------------------
echo ""
echo "Chain to be reset"
echo "  deployment : $root"
echo "  name       : ${chain_name:-<not recorded in gen.env>}"
echo "  chain id   : ${chain_id:-<not found in genesis.json>}"
echo "  chainspec  : ${spec_name:-<no chainspec.json>}"
echo "  head block : $block_line"
echo ""
echo "Directories to be deleted (${#datadirs[@]}):"
for d in "${datadirs[@]}"; do
  printf '  %s  %s\n' "$(du -sh "$d" 2>/dev/null | cut -f1 | xargs)" "$root/$d"
done
echo ""
echo "  chain data total : $(du -sch "${datadirs[@]}" 2>/dev/null | tail -1 | cut -f1 | xargs)"
echo "  deployment total : $(du -sh "$root" 2>/dev/null | cut -f1 | xargs)"

banner \
  "This deletes the chain data listed above." \
  "" \
  "Every block, balance and deployed contract is lost." \
  "Keys, genesis.json, chainspec.json and the env files are kept." \
  "" \
  "This cannot be undone."

read -r -p "Type Y to proceed, anything else to cancel: " reply
if [[ $reply != "Y" ]]; then
  echo "Cancelled. Nothing was stopped and nothing was deleted."
  exit 1
fi

# --------------------------------------------------------------------------
# Stop first. Deleting a running node's data directory leaves it writing into a
# path that no longer exists.
# --------------------------------------------------------------------------
echo ""
echo "Stopping containers..."
if [[ -f docker-down.sh ]]; then
  bash docker-down.sh "$@"
else
  # a subnet deployment gets no docker-down.sh, so drive compose directly
  profile="$1"
  if [[ -z $profile ]]; then
    profiles=($($compose config --profiles))
    if [[ ${#profiles[@]} == 1 ]]; then
      profile="${profiles[0]}"
    elif [[ ${#profiles[@]} == 0 ]]; then
      echo "Error: no profile found in docker-compose.yml, cannot stop the containers."
      echo "NOTHING WAS DELETED."
      exit 2
    else
      echo "Error: this deployment has more than one profile; name the one to reset."
      echo "Usage: ./scripts/reset-chain.sh PROFILE"
      echo "Profiles: ${profiles[*]}"
      echo "NOTHING WAS DELETED."
      exit 2
    fi
  fi
  $compose --profile "$profile" down
fi

down_result=$?
if [[ $down_result != 0 ]]; then
  banner \
    "Failed to stop the containers (exit $down_result)." \
    "" \
    "NOTHING WAS DELETED." \
    "Stop them by hand, then run this again."
  exit $down_result
fi

echo ""
echo "Removing chain data..."
for d in "${datadirs[@]}"; do
  echo "  $root/$d"
  rm -rf -- "$root/$d"
done

banner \
  "Reset complete. ${#datadirs[@]} directory(ies) removed from $root" \
  "" \
  "Bring the chain back up from block 0 with ./docker-up.sh"
