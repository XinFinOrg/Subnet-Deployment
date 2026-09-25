const ethers = require("ethers");
const configModule = require("./config_gen");
const config = configModule.config;
Object.freeze(config);

module.exports = {
  genSubnetConfig,
  genNethermindSubnetConfig,
  genServicesConfig,
  genContractDeployEnv,
  bootnodeEnode,
};

// An enode id is the uncompressed secp256k1 public key without its 0x04 prefix.
// Deriving it from the bootnode.key gen writes is what keeps the two in step —
// hardcoding the id let it drift from whatever key the bootnode came up with.
const BOOTNODE_ENODE_ID = new ethers.SigningKey(
  `0x${config.bootnode_pk}`
).publicKey.slice(4);

function bootnodeEnode(ip_record) {
  const bootnode_ip =
    config.num_machines === 1 ? ip_record["bootnode"] : config.ip_1;
  return `enode://${BOOTNODE_ENODE_ID}@${bootnode_ip}:20301`;
}

function genSubnetConfig(subnet_id, key, ip_record) {
  const key_name = `key${subnet_id}`;
  let private_key = key[key_name]["PrivateKey"];
  private_key = private_key.slice(2, private_key.length); // remove 0x for subnet conf
  const port = 20303 + subnet_id - 1;
  const rpcport = 8545 + subnet_id - 1;
  const wsport = 9555 + subnet_id - 1;
  const stats_ip = config.num_machines === 1 ? ip_record["stats"] : config.ip_1;
  const config_env = `
INSTANCE_NAME=subnet${subnet_id}
PRIVATE_KEY=${private_key}
BOOTNODES=${bootnodeEnode(ip_record)}
NETWORK_ID=${config.network_id}
SYNC_MODE=full
RPC_API=db,eth,debug,miner,net,shh,txpool,personal,web3,XDPoS
STATS_SERVICE_ADDRESS=${stats_ip}:5213
STATS_SECRET=${config.secret_string}
PORT=${port}
RPCPORT=${rpcport}
WSPORT=${wsport}
LOG_LEVEL=4
`;

  return config_env;
}

// Per-node env file (subnet<i>nmc.env) for a Nethermind subnet node. Nethermind
// reads NETHERMIND_<CATEGORY>CONFIG_<PROPERTY> env vars; everything shared and
// static lives in xdc-nmc.json, so only per-node values are emitted here.
// Ports match genSubnetConfig so a node keeps its slot when its client changes.
function genNethermindSubnetConfig(subnet_id, key, ip_record) {
  const private_key = key[`key${subnet_id}`]["PrivateKey"]; // 0x-prefixed, unlike the Go client's
  const port = 20303 + subnet_id - 1;
  const rpcport = 8545 + subnet_id - 1;
  const ip = ip_record[`subnet${subnet_id}`];
  const config_env = `
NETHERMIND_JSONRPCCONFIG_ENABLED=true
NETHERMIND_JSONRPCCONFIG_HOST=0.0.0.0
NETHERMIND_JSONRPCCONFIG_PORT=${rpcport}
NETHERMIND_NETWORKCONFIG_P2PPORT=${port}
NETHERMIND_NETWORKCONFIG_DISCOVERYPORT=${port}
NETHERMIND_NETWORKCONFIG_EXTERNALIP=${ip}
NETHERMIND_NETWORKCONFIG_BOOTNODES=${bootnodeEnode(ip_record)}
NETHERMIND_INITCONFIG_DISCOVERYENABLED=true
NETHERMIND_MININGCONFIG_ENABLED=true
NETHERMIND_KEYSTORECONFIG_TESTNODEKEY=${private_key}
NETHERMIND_HEALTHCHECKSCONFIG_ENABLED=true
NETHERMIND_METRICSCONFIG_ENABLED=true
NETHERMIND_METRICSCONFIG_EXPOSEPORT=8009
NO_COLOR=1
`;

  return config_env;
}

function genServicesConfig() {
  const url = config.parentnet.url;
  const bootnode_ip =
    config.num_machines === 1 ? ip_record["bootnode"] : config.ip_1;
  const subnet_ip =
    config.num_machines === 1 ? ip_record["subnet1"] : config.ip_1;
  let config_env = `
# Bootnode
EXTIP=${bootnode_ip}
BOOTNODE_PORT=20301

# Stats and relayer
PARENTNET_URL=${url}
PARENTNET_WALLET=${config.parentnet.pubkey}
SUBNET_URL=http://${subnet_ip}:8545
RELAYER_MODE=${config.relayer_mode}
SLACK_WEBHOOK=https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXXXXXX
CORS_ALLOW_ORIGIN=*

# Frontend 
VITE_SUBNET_URL=http://${config.public_ip}:5213
VITE_SUBNET_RPC=http://${config.public_ip}:8545

# Share Variable
STATS_SECRET=${config.secret_string}

# CSC
PARENTNET_WALLET_PK=${config.parentnet.privatekey}

`;

  if (config.zero.zero_mode == "one-directional") {
    config_env += `
# XDC-ZERO
PARENTNET_ZERO_WALLET_PK=${config.zero.parentnet_zero_wallet_pk}
  `;
  } else if (config.zero.zero_mode == "bi-directional") {
    config_env += `
# XDC-ZERO
PARENTNET_ZERO_WALLET_PK=${config.zero.parentnet_zero_wallet_pk}
SUBNET_WALLET_PK=${config.zero.subnet_wallet_pk}
SUBNET_ZERO_WALLET_PK=${config.zero.subnet_zero_wallet_pk}
  `;
  }
  // # Parent Chain Observe Node
  // PARENTNET_NODE_NAME=mainnet_observer
  // PRIVATE_KEYS=11111111111111111111111111111111111111111111111111111111111111
  return config_env;
}

function genContractDeployEnv(ip_record) {
  const subnet_ip =
    config.num_machines === 1 ? ip_record["subnet1"] : config.ip_1;
  const config_deploy = `
PARENTNET_URL=${config.parentnet.url}
SUBNET_URL=http://${subnet_ip}:8545

PARENTNET_PK=${config.parentnet.privatekey}
SUBNET_PK=${config.keys.grandmaster_pk}

`;
  return config_deploy;
}
