const axios = require("axios");
const instance = axios.create({
  socketPath: "/var/run/docker.sock",
  baseURL: "http://unix:/",
});

module.exports = {
  getState,
  getSubnetContainers,
  getContainersState,
  checkMining,
};

async function getState() {
  containers = await getContainersState()
  // containers = await getSubnetContainers()
  mineInfo = await checkMining() 
  // contracts = await checkContractState()

  return {
    containers: containers,
    mineInfo: mineInfo
  }
}

async function getSubnetContainers() {
  const response = await instance.get("http://localhost/containers/json");
  const containers = response.data;
  const filtered = [];
  for (let i = 0; i < containers.length; i++) {
    if (containers[i].Names[0].includes("generated")) {
      const c = {
        name: containers[i].Names[0].substring(1),
        image: containers[i].Image,
        state: containers[i].State,
        status: containers[i].Status,
      };
      const networkName = containers[i].HostConfig.NetworkMode;
      const ip =
        containers[i].NetworkSettings.Networks[networkName].IPAMConfig
          .IPv4Address;
      const rpcPort = extractRPCPort(c.name);
      c.network = networkName;
      c.ip = ip;
      c.rpcPort = rpcPort;
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

async function checkDeployState() {
//maybe too similar to getcontainersstate (already displayed)
}

async function checkContractState() {
// csc = lite/full, deployed/notfound, (current height?)
// reverse csc = deployed/notfound
// subswap = deployed/notfound


}

async function checkMining() {
  const containers = await getSubnetContainers();
  const blockHeights = [];
  const peerCounts = [];
  for (let i = 0; i < containers.length; i++) {
    const c = containers[i];
    if (c.name.includes("subnet") && c.state == "running") {
      blockHeights.push(await checkBlock(c.ip, c.rpcPort));
      peerCounts.push(await checkPeers(c.ip, c.rpcPort));
    }
  }
  return {
    blocks: blockHeights,
    peers: peerCounts,
  };
}

async function checkBlock(containerIP, containerPort) {
  let url = `http://${containerIP}:${containerPort}`;
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
    let response;
    try {
      response = await axios.post(url, data, { headers, timeout: 2000 });
    } catch (error) {
      url = `http://localhost:${containerPort}`; //fallback for local testing
      response = await axios.post(url, data, { headers, timeout: 2000 });
    }
    let block = response.data.result.Number;
    if (block == null) block = 0;
    return block;
  } catch (error) {
    console.log(error.code);
  }
}

async function checkPeers(containerIP, containerPort) {
  let url = `http://${containerIP}:${containerPort}`;
  const data = {
    jsonrpc: "2.0",
    method: "net_peerCount",
    id: 1,
  };
  const headers = {
    "Content-Type": "application/json",
  };

  try {
    let response;
    try {
      response = await axios.post(url, data, { headers, timeout: 2000 });
    } catch (error) {
      url = `http://localhost:${containerPort}`; //fallback for local testing
      response = await axios.post(url, data, { headers, timeout: 2000 });
    }
    const peerHex = response.data.result;
    const peerCount = parseInt(peerHex, 16);
    return peerCount;
  } catch (error) {
    console.error(error.code);
  }
}

function confirmCompatible() {
  //check docker version
  //check docker compose version
  // only requirement is docker
  //
  // for init
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

function extractRPCPort(name) {
  const shortName = name.split("-")[1];
  nodeNum = parseInt(shortName.replace("subnet", ""));
  // if (nodeNum === null) {
  //   return 9999;
  // }
  return 8545 + nodeNum - 1;
}


function sleepSync(ms) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    // Busy-wait loop (blocks the event loop)
  }
}