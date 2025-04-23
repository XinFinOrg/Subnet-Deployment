const axios = require("axios");
const { ethers } = require("ethers");
const { getAccountPath } = require("ethers");
const instance = axios.create({
  socketPath: "/var/run/docker.sock",
  baseURL: "http://unix:/",
});
const fs = require("fs");
const path = require("path");
const mountPath = path.join(__dirname, "../../mount/generated/");

module.exports = {
  getState,
  getSubnetContainers,
  getContainersState,
  checkMining,
  getFaucetParams,
};

const stateGen = {
  NONE: "NONE",
  INCOMPLETE: "INCOMPLETE",
  GENERATED: "GENERATED",
  COMPLETED: "COMPLETED",
};

async function getState() {
  const [deployState, requireContracts] = getStateGen();
  const containers = await getContainersState();
  const mineInfo = await checkMining();

  return {
    containers: containers,
    mineInfo: mineInfo,
    deployState: deployState,
    requirements: requireContracts,
  };
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
  const subswap = [];
  const explorer = [];
  const others = [];
  for (let i = 0; i < containers.length; i++) {
    const [isSubnet, nameSubnet] = isSubnetContainer(containers[i].name);
    const [isService, nameService] = isServiceContainer(containers[i].name);
    const isSubswap = isSubswapContainer(containers[i].name);
    const isExplorer = isExplorerContainer(containers[i].name);
    if (isSubnet) {
      subnets.push({
        name: nameSubnet,
        state: containers[i].state,
      });
    } else if (isService) {
      services.push({
        name: nameService,
        state: containers[i].state,
      });
    } else if (isSubswap) {
      subswap.push({
        name: nameService,
        state: containers[i].state,
      });
    } else if (isExplorer) {
      explorer.push({
        name: nameService,
        state: containers[i].state,
      });
    } else {
      others.push({
        name: nameService,
        state: containers[i].state,
      });
    }
  }

  return {
    subnets: subnets,
    services: services,
    subswap: subswap,
    explorer: explorer,
    others: others,
  };
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
  if (name.includes("subnet") || name.includes("bootnode")) {
    isSubnet = true;
  }
  return [isSubnet, name];
}

function isServiceContainer(container) {
  container = container.split("-"); //container name format: generated-xxxxx-1, need to extract middle string
  container.pop();
  container.shift();
  const name = container.join();
  let isService = false;
  if (name.includes("subswap_frontend")) return [false, name];
  if (
    name.includes("stats") ||
    name.includes("frontend") ||
    name.includes("relayer") ||
    name.includes("bootnode")
  ) {
    isService = true;
  }
  return [isService, name];
}

function isSubswapContainer(container) {
  container = container.split("-"); //container name format: generated-xxxxx-1, need to extract middle string
  container.pop();
  container.shift();
  const name = container.join();
  if (name.includes("subswap_frontend")) {
    return true;
  } else {
    return false;
  }
}

function isExplorerContainer(container) {
  container = container.split("-"); //container name format: generated-xxxxx-1, need to extract middle string
  container.pop();
  container.shift();
  const name = container.join();
  if (name.includes("explorer")) {
    return true;
  } else {
    return false;
  }
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

function getStateGen() {
  files = [
    "gen.env",
    "docker-compose.yml",
    "common.env",
    "contract_deploy.env",
    "genesis.json",
  ];
  let count = 0;
  for (let i = 0; i < files.length; i++) {
    filename = path.join(mountPath, files[i]);
    if (fs.existsSync(filename)) count++;
  }

  if (count == 0) return [stateGen.NONE, null];
  if (count < files.length) return [stateGen.INCOMPLETE, null];

  const req = readContractRequirement();
  const addresses = readAddressInfo();
  const contracts = readDeployedContracts();
  const subnetConfig = readConfig();
  const details = {
    requireContracts: req,
    deployedContracts: contracts,
    addresses: addresses,
    subnetConfig: subnetConfig,
  };
  if (isContractDeployComplete(req)) {
    return [stateGen.COMPLETED, details];
  } else {
    return [stateGen.GENERATED, details];
  }
}

function pkToAddress(pk) {
  try {
    const privateKey = pk.split("=")[1];
    const wallet = new ethers.Wallet(privateKey);
    const address = wallet.address;
    return address;
  } catch (error) {
    return "";
  }
}

function readContractRequirement() {
  const filepath = path.join(mountPath, "gen.env");
  if (!fs.existsSync(filepath)) return {};
  const relayerMode = findENVInFile("RELAYER_MODE", filepath);
  const zeroMode = findENVInFile("XDC_ZERO", filepath);
  const subswap = findENVInFile("SUBSWAP", filepath);

  const req = {};
  if (relayerMode.length != 0) {
    req["relayer"] = relayerMode[0].split("=")[1];
  }
  if (zeroMode.length != 0) {
    req["zero"] = zeroMode[0].split("=")[1];
  }
  if (subswap.length != 0) {
    req["subswap"] = subswap[0].split("=")[1];
  }
  return req;
}

function readAddressInfo() {
  const filepath = path.join(mountPath, "gen.env");
  if (!fs.existsSync(filepath)) return {};
  let parentnetWallet = findENVInFile("PARENTNET_WALLET_PK", filepath);
  parentnetWallet =
    parentnetWallet.length > 0 ? pkToAddress(parentnetWallet[0]) : "";
  let parentnetZeroWallet = findENVInFile("PARENTNET_ZERO_WALLET_PK", filepath);
  parentnetZeroWallet =
    parentnetZeroWallet.length > 0 ? pkToAddress(parentnetZeroWallet[0]) : "";
  let subnetWallet = findENVInFile("SUBNET_WALLET_PK", filepath);
  subnetWallet = subnetWallet.length > 0 ? pkToAddress(subnetWallet[0]) : "";
  let subnetZeroWallet = findENVInFile("SUBNET_ZERO_WALLET_PK", filepath);
  subnetZeroWallet =
    subnetZeroWallet.length > 0 ? pkToAddress(subnetZeroWallet[0]) : "";

  return {
    parentnetWallet: parentnetWallet,
    parentnetZeroWallet: parentnetZeroWallet,
    subnetWallet: subnetWallet,
    subnetZeroWallet: subnetZeroWallet,
  };
}

function readDeployedContracts() {
  const filepath = path.join(mountPath, "common.env");
  if (!fs.existsSync(filepath)) return {};

  let csc = findENVInFile("CHECKPOINT_CONTRACT", filepath);
  csc = csc.length > 0 ? csc[0].split("=")[1] : "";
  let reverseCsc = findENVInFile("REVERSE_CHECKPOINT_CONTRACT", filepath);
  reverseCsc = reverseCsc.length > 0 ? reverseCsc[0].split("=")[1] : "";
  let zeroContract = findENVInFile("PARENTNET_ZERO_CONTRACT", filepath); //checkname
  zeroContract = zeroContract.length > 0 ? zeroContract[0].split("=")[1] : "";
  let reverseZeroContract = findENVInFile("SUBNET_ZERO_CONTRACT", filepath); //checkname
  reverseZeroContract =
    reverseZeroContract.length > 0 ? reverseZeroContract[0].split("=")[1] : "";
  let parentnetApp = findENVInFile("PARENTNET_APP", filepath);
  parentnetApp = parentnetApp.length > 0 ? parentnetApp[0].split("=")[1] : "";
  let subnetApp = findENVInFile("SUBNET_APP", filepath);
  subnetApp = subnetApp.length > 0 ? subnetApp[0].split("=")[1] : "";

  return {
    csc: csc,
    reverseCsc: reverseCsc,
    zeroContract: zeroContract,
    reverseZeroContract: reverseZeroContract,
    parentnetApp: parentnetApp,
    subnetApp: subnetApp,
  };
}

function readConfig() {
  const filepath = path.join(mountPath, "gen.env");
  if (!fs.existsSync(filepath)) return {};

  let networkName = findENVInFile("NETWORK_NAME", filepath);
  networkName = networkName.length > 0 ? networkName[0].split("=")[1] : "";
  let numSubnet = findENVInFile("NUM_SUBNET", filepath);
  numSubnet = numSubnet.length > 0 ? numSubnet[0].split("=")[1] : "";
  let numMachine = findENVInFile("NUM_MACHINE", filepath);
  numMachine = numMachine.length > 0 ? numMachine[0].split("=")[1] : "";
  let parentnet = findENVInFile("PARENTNET", filepath);
  parentnet = parentnet.length > 0 ? parentnet[0].split("=")[1] : "";

  return {
    networkName: networkName,
    numSubnet: numSubnet,
    numMachine: numMachine,
    parentnet: parentnet,
  };
}

function isContractDeployComplete(req) {
  const filepath = path.join(mountPath, "common.env");
  if ("relayer" in req) {
    const relayer = findENVInFile("CHECKPOINT_CONTRACT", filepath); //check name
    if (relayer.length == 0) return false;
  }

  if ("zero" in req) {
    const zero = findENVInFile("ZERO_CONTRACT", filepath); //check name
    if (zero.length == 0) return false;
  }

  if ("subswap" in req) {
    const subswap = findENVInFile("_APP", filepath); //check name
    if (subswap.length == 0) return false;
  }

  return true;
}

function findENVInFile(env, filepath) {
  const envFileContent = fs.readFileSync(filepath, "utf8");
  const regex = new RegExp(`^${env}=.*`, "gm");
  let matches = envFileContent.match(regex);
  matches = matches === null ? [] : matches;
  return matches;
}

function getFaucetParams() {
  const keysFile = fs.readFileSync(path.join(mountPath, "keys.json"), "utf8");
  const gmKey = JSON.parse(keysFile).Grandmaster.PrivateKey;
  const commonPath = path.join(mountPath, "common.env");
  const url = findENVInFile("SUBNET_URL", commonPath)[0].split("=")[1];

  return {
    subnetUrl: url,
    gmKey: gmKey,
  };
}
