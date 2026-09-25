#!/bin/bash
# Report whether the subnet is producing blocks, by sampling the head block a
# few times and checking it advances.
#
# Usage: ./scripts/check-mining.sh [url-or-port]
#   defaults to http://localhost:8545 (subnet1). Pass 8547, or a full url, to
#   ask a different node.

target="${1:-8545}"
if [[ "$target" == http://* || "$target" == https://* ]]; then
  url="$target"
else
  url="http://localhost:${target}"
fi

rpc() {
  curl -s -m 10 --location "$url" \
    --header 'Content-Type: application/json' \
    --data "{\"jsonrpc\":\"2.0\",\"method\":\"$1\",\"params\":$2,\"id\":1}"
}

# The two clients report the head block differently:
#   Go (xdcsubnets): "Number":189        decimal, capitalised key
#   Nethermind:      "number":"0xbd"     hex string, lowercase key
# Match either, and normalise to decimal.
parse_block_number() {
  local raw
  raw=$(printf '%s' "$1" \
    | grep -oiE '"number"[[:space:]]*:[[:space:]]*"?(0x[0-9a-fA-F]+|[0-9]+)"?' \
    | head -1 \
    | sed -E 's/.*:[[:space:]]*"?//; s/"$//')
  [[ -z "$raw" ]] && return 1
  # bash printf reads 0x.. natively, so this covers both forms
  printf '%d' "$raw" 2>/dev/null || return 1
}

get_block() {
  local resp num
  # XDPoS_getV2BlockByNumber needs the Xdc namespace, which a Nethermind node
  # only serves when JsonRpc.EnabledModules includes it -- fall back to the
  # standard call so this still works when it does not.
  resp=$(rpc XDPoS_getV2BlockByNumber '["latest"]')
  if num=$(parse_block_number "$resp"); then
    printf '%s' "$num"
    return 0
  fi
  resp=$(rpc eth_blockNumber '[]')
  if num=$(parse_block_number "$(printf '%s' "$resp" | sed -E 's/"result"/"number"/')"); then
    printf '%s' "$num"
    return 0
  fi
  return 1
}

echo "checking $url"
echo "getting latest block"
if ! num=$(get_block); then
  echo "no block has been mined, please check if nodes are peering properly"
  exit 1
fi
echo "$num"

nextnum=$num
for i in 2 3 4; do
  sleep 3
  echo "getting latest block $i"
  if ! nextnum=$(get_block); then
    echo "node stopped answering, please check if it is still running"
    exit 1
  fi
  echo "$nextnum"
done

# numeric, not the string comparison this used to do: [[ 9 > 10 ]] is true
if [[ "$nextnum" -gt "$num" ]]; then
  echo "subnet successfully running and mining blocks"
else
  echo "block number has not advanced ($num -> $nextnum), subnet is not mining"
  exit 1
fi
