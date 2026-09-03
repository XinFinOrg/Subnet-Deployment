#!/bin/bash
image_version="${GENERATOR_IMAGE_VERSION:-xinfinorg/subnet-generator:generator-v3.1.0}"
current_dir="$(cd "$(dirname "$0")" && pwd)"
network_name="docker_net"

docker pull $image_version
# Check the exit code
if [ $? -eq 0 ]; then
    echo "SUCCESS: Docker pull completed successfully"
else
    echo "FAILED: Docker pull failed with exit code $?"
    exit 1
fi

mkdir -p generated/scripts

if ! docker network inspect "$network_name" > /dev/null 2>&1; then
  echo "Network '$network_name' does not exist. Creating it..."
  docker network create --subnet 192.168.25.0/24 "$network_name"
else
  echo "Joining existing network '$network_name'"
fi

docker run -d                                   \
  --network "docker_net" --ip=192.168.25.111    \
  -p 5210:5210                                  \
  -v /var/run/docker.sock:/var/run/docker.sock  \
  -v $current_dir/generated:/mount/generated    \
  -e HOSTPWD=$current_dir/generated             \
  -e NON_SUBNET=true                            \
  $image_version                                \
  && \
echo '' && \
echo '' && \
echo '' && \
echo 'if this is running on your server, first use ssh tunnel: ssh -N -L localhost:5210:localhost:5210 <username>@<ip_address> -i <private_key_file>' && \
echo 'if you are using VSCode Remote Explorer, ssh tunnel will be available by default' && \
echo -e '\n\nhttp://localhost:5210/gen_xdpos to start XDPoS private network generator'