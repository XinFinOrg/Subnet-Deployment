const axios = require("axios");
const instance = axios.create({
  socketPath: "/var/run/docker.sock",
  baseURL: "http://unix:/",
});

module.exports = {
  getSubnetContainers,
  getContainersState,
  checkMining,
  streamContainersState,
};

function streamContainersState() {}

async function getSubnetContainers() {
  const response = await instance.get("http://localhost/containers/json");
  const containers = response.data;
  const filtered = [];
  for (let i = 0; i < containers.length; i++) {
    if (containers[i].Names[0].includes("generated")) {
      const networkName = containers[i].HostConfig.NetworkMode;
      const c = {
        name: containers[i].Names[0].substring(1),
        image: containers[i].Image,
        state: containers[i].State,
        status: containers[i].Status,
        network: networkName,
        ip: containers[i].NetworkSettings.Networks[networkName].IPAMConfig
          .IPv4Address,
      };
      filtered.push(c);
    }
  }
  return filtered;
}

async function getContainersState() {
  const containers = await getSubnetContainers();
  const subnets = [];
  const services = [];
  for (let i = 0; i < containers.length; i++) {
    const [isSubnet, name] = isSubnetContainer(containers[i].name);
    const container = {
      name: name,
      state: containers[i].state,
    };
    isSubnet ? subnets.push(container) : services.push(container);
  }
  return [subnets, services];
}

async function checkDeployState() {}

function checkContractState() {}

async function checkMining() {
  const containers = await getSubnetContainers();
  const blockHeights = [];
  const peerCounts = [];
  for (let i = 0; i < containers.length; i++) {
    const c = containers[i];
    if (c.name.includes("subnet") && c.state == "running") {
      blockHeights.push(await checkBlock(c.ip));
      peerCounts.push(await checkPeers(c.ip));
    }
  }
  return {
    blocks: blockHeights,
    peers: peerCounts,
  };
}

async function checkBlock(containerIP) {
  // const url = `http://${containerIP}:8545`;
  const url = `http://localhost:8545`; //local testing
  const data = {
    jsonrpc: "2.0",
    method: "XDPoS_getV2BlockByNumber",
    params: ["latest"],
    id: 1,
  };
  const headers = {
    "Content-Type": "application/json",
  };

  try {
    const response = await axios.post(url, data, { headers });
    let block = response.data.result.Number;
    if (block == null) block = 0;
    return block;
  } catch (error) {
    console.error(error);
  }
}

async function checkPeers(containerIP) {
  // const url = `http://${containerIP}:8545`;
  const url = `http://localhost:8545`; //local testing
  const data = {
    jsonrpc: "2.0",
    method: "net_peerCount",
    id: 1,
  };
  const headers = {
    "Content-Type": "application/json",
  };

  try {
    const response = await axios.post(url, data, { headers });
    const peerHex = response.data.result;
    const peerCount = parseInt(peerHex, 16);
    return peerCount;
  } catch (error) {
    console.error(error);
  }
}

function confirmCompatible() {
  //check docker version
  //check docker compose version
  // only requirement is docker
}

function isSubnetContainer(container) {
  container = container.split("-"); //container name format: generated-xxxxx-1, need to extract middle string
  container.pop();
  container.shift();
  const name = container.join();
  let isSubnet = false;
  if (name.includes("subnet")) {
    isSubnet = true;
  }
  return [isSubnet, name];
}
