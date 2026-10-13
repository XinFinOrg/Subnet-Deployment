#!/bin/bash

image_version="${GENERATOR_IMAGE_VERSION:-xinfinorg/subnet-generator:generator-v3.1.0}"
current_dir="$(cd "$(dirname "$0")" && pwd)"
network_name="docker_net"
container_name="subnet-generator"
port=5210
docker_ip=192.168.25.111

main() {
  pull_image
  mkdir -p "$current_dir/generated/scripts"
  remove_existing
  check_conflicts
  ensure_network

  # stderr is left uncaptured: docker puts the container id on stdout and
  # warnings on stderr, so merging them puts warning text where the id goes
  local id
  if ! id=$(docker run -d                           \
      --name "$container_name"                      \
      --network "$network_name" --ip="$docker_ip"   \
      -p $port:$port                                \
      -v /var/run/docker.sock:/var/run/docker.sock  \
      -v "$current_dir/generated:/mount/generated"  \
      -e HOSTPWD="$current_dir/generated"           \
      "$image_version"); then
    # docker leaves the container in Created state, where it blocks the next run
    docker rm -f "$container_name" > /dev/null 2>&1
    fail "docker run failed, see the error above"
  fi

  echo "Started generator '$container_name' (${id:0:12})"
  echo ""
  echo "======================================================================"
  echo "  if this is running on your server, first use ssh tunnel:"
  echo "    ssh -N -L localhost:$port:localhost:$port <username>@<ip_address> -i <private_key_file>"
  echo "  if you are using VSCode Remote Explorer, ssh tunnel is available by default"
  echo ""
  echo "  http://localhost:$port to access Subnet Deployment Wizard"
  echo "======================================================================"
  echo ""
}

# docker's error for a taken port or ip is a wall of endpoint ids that never
# says what is holding it, so bail out with a name instead
fail() {
  echo ""
  echo "======================================================================"
  echo "  CANNOT START: $1"
  if [[ -n $2 ]]; then
    echo "  $2"
  fi
  echo "======================================================================"
  echo ""
  exit 1
}

pull_image() {
  docker pull "$image_version"
  local result=$?
  if [[ $result != 0 ]]; then
    fail "docker pull $image_version failed with exit code $result"
  fi
  echo "SUCCESS: Docker pull completed successfully"
}

# every run starts a fresh container, so what runs always matches the image just
# pulled; a container left over from a previous run is removed, and said so out
# loud rather than leaving it to be guessed at
remove_existing() {
  local existing status
  existing=$(docker ps -aq --filter "name=^${container_name}$")
  if [[ -z $existing ]]; then
    return
  fi
  status=$(docker inspect "$existing" --format '{{.State.Status}}')
  echo "Replacing previous generator '$container_name' ($status, ${existing:0:12})"
  docker rm -f "$existing" > /dev/null
}

# run after remove_existing, so our own container is never the reported culprit
check_conflicts() {
  local holder
  holder=$(docker ps --filter "publish=$port" --format '{{.Names}} ({{.Image}})' | head -1)
  if [[ -z $holder ]] && command -v lsof > /dev/null 2>&1; then
    holder=$(lsof -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | awk 'NR==2 {print $1" (pid "$2")"}')
  fi
  if [[ -n $holder ]]; then
    fail "port $port is already in use by $holder" \
         "Free the port, then run this again."
  fi

  # IPv4Address comes back as <ip>/<prefix>, so match the leading "<ip>/" and
  # not the bare address, which would also match e.g. .1110
  holder=$(docker network inspect "$network_name" --format '{{range .Containers}}{{.Name}} {{.IPv4Address}}
{{end}}' 2>/dev/null | awk -v want="$docker_ip/" 'index($2, want) == 1 { print $1; exit }')
  if [[ -n $holder ]]; then
    fail "ip $docker_ip on network '$network_name' is taken by container $holder" \
         "Stop that container, then run this again."
  fi
}

ensure_network() {
  if docker network inspect "$network_name" > /dev/null 2>&1; then
    echo "Joining existing network '$network_name'"
  else
    echo "Network '$network_name' does not exist. Creating it..."
    docker network create --subnet 192.168.25.0/24 "$network_name"
  fi
}

main "$@"
