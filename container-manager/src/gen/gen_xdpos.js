const crypto = require("crypto");
const fs = require("fs");
const net = require("net");
const ethers = require("ethers");
const yaml = require("js-yaml");
const { exit } = require("process");
const configModule = require("./config_gen");
const gen_compose = require("./gen_compose");
const gen_env = require("./gen_env");
const gen_other = require("./gen_other");

const config = configModule.config;
initConfig(config);

Object.freeze(config);
console.log("config", config);

let bootnode = "";
const keys = genXdposKeys();
const num_per_machine = Array(config.num_machines);
// integer division
for (let i = 0; i < config.num_machines; i++) {
  num_per_machine[i] = Math.floor(config.num_subnet / config.num_machines);
}
// divide up the remainder
for (let i = 0; i < config.num_subnet % config.num_machines; i++) {
  num_per_machine[i]++;
}
num_per_machine.reverse(); // let first machines host services, put fewer subnets

// gen docker-compose
let doc = {
  // version: "3.7",      //docker deprecated attribute
  services: {},
};

let start_num = 1;
for (let i = 1; i <= config.num_machines; i++) {
  const nodes = genXdposCompose(
    (machine_id = i),
    (num = num_per_machine[i - 1]),
    (start_num = start_num),
  );
  start_num += num_per_machine[i - 1];
  Object.entries(nodes).forEach((entry) => {
    const [key, value] = entry;
    doc["services"][key] = value;
  });
}

doc["services"]["bootnode"] = {
    image: `xinfinorg/xdcsubnets:${config.version.bootnode}`,
    restart: "always",
    volumes: ["./bootnodes:/work/bootnodes"],
    entrypoint: ["bash", "/work/start-bootnode.sh"],
    command: ["-verbosity", "6", "-nodekey", "bootnode.key"],
    ports: ["20301:20301/tcp", "20301:20301/udp"],
    environment: ["BOOTNODE_PORT=20301"],
    profiles: ["machine1"],
  };


// checkpoint smartcontract deployment config
doc, (ip_record = gen_compose.injectNetworkConfig(doc));

// bootnode enode for bootnodes.list — set here so it is populated even when
// every masternode runs Nethermind (and genXdposNodeConfig is never called).
const bootnode_ip =
  config.num_machines === 1 ? ip_record["bootnode"] : config.ip_1;
bootnode = `enode://cc566d1033f21c7eb0eb9f403bb651f3949b5f63b40683917765c343f9c0c596e9cd021e2e8416908cbc3ab7d6f6671a83c85f7b121c1872f8be50a591723a5d@${bootnode_ip}:20301\n`;

subnetconf = [];
for (let i = 1; i <= config.num_subnet; i++) {
  if (isNethermindNode(i)) {
    subnetconf.push({
      filename: `masternode${i}nmc.env`,
      content: genNethermindNodeConfig(i, keys, ip_record),
    });
  } else {
    subnetconf.push({
      filename: `masternode${i}.env`,
      content: genXdposNodeConfig(i, keys, ip_record),
    });
  }
}

const compose_content = yaml.dump(doc, {});

const genesis_input = genGenesisInputFileXdpos(
  keys
);
const genesis_input_file = yaml.dump(genesis_input, {});

writeGenerated(config.generator.output_path);
copyScripts(config.generator.output_path);

console.log("gen successful");

function writeGenerated(output_dir) {
  // const pathCommand =
  //   `cd ${mountPath};\n` +
  //   `export PWD=${config.hostPath};\n` +
  //   `${command}

  // writing files
  // fs.rmSync(`${output_path}`, { recursive: true, force: true }); //wont work with docker mount
  // fs.mkdirSync(`${output_path}`) //won't work with docker mount
  fs.writeFileSync(`${output_dir}/placeholder.txt`, "-", (err) => {
    if (err) {
      console.error(err);
      exit();
    }
  });

  fs.writeFileSync(`${output_dir}/bootnodes.list`, bootnode, (err) => {
    if (err) {
      console.error(err);
      exit();
    }
  });

  fs.writeFileSync(
    `${output_dir}/docker-compose.yml`,
    compose_content,
    (err) => {
      if (err) {
        console.error(err);
        exit();
      }
    }
  );

  const keys_json = JSON.stringify(keys, null, 2);
  fs.writeFile(`${output_dir}/keys.json`, keys_json, (err) => {
    if (err) {
      console.error("Error writing key file:", err);
      exit();
    }
  });

  for (let i = 1; i <= config.num_subnet; i++) {
    fs.writeFileSync(
      `${output_dir}/${subnetconf[i - 1].filename}`,
      subnetconf[i - 1].content,
      (err) => {
        if (err) {
          console.error(err);
          exit();
        }
      }
    );
  }

  fs.writeFileSync(
    `${output_dir}/genesis_input.yml`,
    genesis_input_file,
    (err) => {
      if (err) {
        console.error(err);
        exit();
      }
    }
  );
}

function copyScripts(output_dir) {
  fs.writeFileSync(`${output_dir}/scripts/placeholder.txt`, "-", (err) => {
    if (err) {
      console.error(err);
      exit();
    }
  });
  fs.copyFileSync(
    `${__dirname}/scripts/check-mining.sh`,
    `${output_dir}/scripts/check-mining.sh`
  );
  fs.copyFileSync(
    `${__dirname}/scripts/check-peer.sh`,
    `${output_dir}/scripts/check-peer.sh`
  );
  fs.copyFileSync(
    `${__dirname}/scripts/docker-up.sh`,
    `${output_dir}/docker-up.sh`
  );
  fs.copyFileSync(
    `${__dirname}/scripts/docker-down.sh`,
    `${output_dir}/docker-down.sh`
  );
  // shared Nethermind config mounted by every nmc node, copied unconditionally
  // so it is always available (chainspec.json is produced separately from
  // genesis.json after puppeth runs)
  fs.copyFileSync(
    `${__dirname}/scripts/xdc-nmc.json`,
    `${output_dir}/xdc-nmc.json`
  );
  // pre-boot check that chainspec.json still matches genesis.json; the check
  // itself runs in a subnet-generator container, so only the wrapper is copied
  fs.copyFileSync(
    `${__dirname}/scripts/check-chainspec.sh`,
    `${output_dir}/scripts/check-chainspec.sh`
  );
}

function initConfig(config) {
  if (!config.num_machines || !config.num_subnet || !config.network_name) {
    console.log("NUM_MACHINE and NUM_SUBNET and NETWORK_NAME must be set");
    process.exit(1);
  }

  if (config.num_machines < 1 || config.num_subnet < 1) {
    console.log("NUM_MACHINE and NUM_SUBNET must be 1 or more");
    process.exit(1);
  }

  if (config.num_nethermind < 0 || config.num_nethermind > config.num_subnet) {
    console.log("NUM_NETHERMIND must be between 0 and NUM_SUBNET");
    process.exit(1);
  }

  if (net.isIP(config.main_ip) != 0) {
    console.log("MAIN_IP Invalid IP address");
    process.exit(1);
  }

  if (!config.network_name || config.network_name === "") {
    console.log("NETWORK_NAME cannot be empty");
    process.exit(1);
  }

  if (config.network_id < 1 || config.network_id >= 65536) {
    console.log("NETWORK_ID should be in range of 1 to 65536");
    process.exit(1);
  }

  if (config.keys.grandmaster_pk !== "") {
    try {
      [config.keys.grandmaster_addr, config.keys.grandmaster_pk] = validatePK(
        config.keys.grandmaster_pk
      );
    } catch {
      console.log("Invalid GRANDMASTER_PK");
      process.exit(1);
    }
  } else {
    const privatekey = crypto.randomBytes(32).toString("hex");
    [config.keys.grandmaster_addr, config.keys.grandmaster_pk] =
      validatePK(privatekey);
  }

  if (config.xdpos.foundation_pk !== "") {
    try {
      [config.xdpos.foundation_addr, config.xdpos.foundation_pk] = validatePK(
        config.xdpos.foundation_pk
      );
    } catch {
      console.log("Invalid FOUNDATION_PK");
      process.exit(1);
    }
  } else {
    const privatekey = crypto.randomBytes(32).toString("hex");
    [config.xdpos.foundation_addr, config.xdpos.foundation_pk] =
      validatePK(privatekey);
  }

  if (config.keys.subnets_pk !== "") {
    try {
      let output_pk = [];
      let output_wallet = [];
      let pks = config.keys.subnets_pk.split(",");
      pks.forEach((pk) => {
        const [address, private_key] = validatePK(pk);
        output_wallet.push(address);
        output_pk.push(private_key);
      });
      config.keys.subnets_pk = output_pk;
      config.keys.subnets_addr = output_wallet;
    } catch {
      console.log(
        "Invalid Privatekeys please make sure keys are correct length, comma separated with no whitespace or invalid characters"
      );
      process.exit(1);
    }

    if (config.keys.subnets_addr.length !== config.num_subnet) {
      console.log(
        `number of keys in (${config.keys.subnets_addr.length}) does not match number of Masternodes (${config.num_subnet})`
      );
      process.exit(1);
    }

    const setPK = new Set(config.keys.subnets_pk);
    if (setPK.size !== config.keys.subnets_pk.length) {
      console.log("found duplicate keys!!!");
      process.exit(1);
    }
  } else {
    let output_pk = [];
    let output_wallet = [];
    for (let i = 0; i < config.num_subnet; i++) {
      const privatekey = crypto.randomBytes(32).toString("hex");
      const [address, private_key] = validatePK(privatekey);
      output_wallet.push(address);
      output_pk.push(private_key);
    }
    config.keys.subnets_pk = output_pk;
    config.keys.subnets_addr = output_wallet;
  }
}

function validatePK(private_key) {
  let wallet = new ethers.Wallet(private_key);
  return [wallet.address, wallet.privateKey];
}

function genGenesisInputFileXdpos(keys) {
  const masternodes = [];
  let masternodesowner = '';
  let foundationaddress = '';
  Object.keys(keys).forEach(function (k) {
    const v = keys[k];
    if (k.startsWith("key")) {
      masternodes.push(v["0x"]);
    } else if (k === "Owner"){
      masternodesowner = v["0x"];
    } else if (k === "Foundation") {
      foundationaddress = v["0x"];
    }
  });

  const out = {
    name: config.network_name,
    masternodesowner: masternodesowner,
    masternodes,
    foundationwalletaddress: foundationaddress,
    chainid: config.network_id,
  };

  if (config.xdpos.stake_threshold != "") {
    out["stakingthreshold"] = config.xdpos.stake_threshold;
  }
  if (config.xdpos.reward_yield != "") {
    out["rewardyield"] = config.xdpos.reward_yield;
  }


  return out;
}

function genXdposNodeConfig(subnet_id, key, ip_record) {
  const key_name = `key${subnet_id}`;
  let private_key = key[key_name]["PrivateKey"];
  private_key = private_key.slice(2, private_key.length); // remove 0x for subnet conf
  const port = 20303 + subnet_id - 1;
  const rpcport = 8545 + subnet_id - 1;
  const wsport = 9555 + subnet_id - 1;
  const bootnode_ip =
    config.num_machines === 1 ? ip_record["bootnode"] : config.ip_1;
  bootnode = `enode://cc566d1033f21c7eb0eb9f403bb651f3949b5f63b40683917\
765c343f9c0c596e9cd021e2e8416908cbc3ab7d6f6671a83c85f7b121c1872f8be\
50a591723a5d@${bootnode_ip}:20301\n`;
  const stats_ip = config.num_machines === 1 ? ip_record["stats"] : config.ip_1;
  const config_env = `
INSTANCE_NAME=Masternode${subnet_id}
PRIVATE_KEY=${private_key}
BOOTNODES=${bootnode}
NETWORK=local
NETWORK_ID=${config.network_id}
GC_MODE=archive
PORT=${port}
RPC_PORT=${rpcport}
WS_PORT=${wsport}
LOG_LEVEL=4
`;

  return config_env;
}

// The last `num_nethermind` masternodes run the Nethermind client instead of
// the Go client. They stay validators and reuse the same key/port/IP slot.
function isNethermindNode(subnet_id) {
  return subnet_id > config.num_subnet - config.num_nethermind;
}

// Per-node env file (masternode<i>nmc.env) — Nethermind reads NETHERMIND_* env
// vars (format NETHERMIND_<CATEGORY>CONFIG_<PROPERTY>). Shared/static settings
// live in xdc-nmc.json; only per-node values are emitted here.
function genNethermindNodeConfig(subnet_id, key, ip_record) {
  const private_key = key[`key${subnet_id}`]["PrivateKey"]; // 0x-prefixed
  const port = 20302 + subnet_id; // P2P + discovery
  const rpcport = 8544 + subnet_id; // JSON-RPC
  const ip = ip_record[`masternode${subnet_id}`];
  const config_env = `
NETHERMIND_JSONRPCCONFIG_ENABLED=true
NETHERMIND_JSONRPCCONFIG_HOST=0.0.0.0
NETHERMIND_JSONRPCCONFIG_PORT=${rpcport}
NETHERMIND_NETWORKCONFIG_P2PPORT=${port}
NETHERMIND_NETWORKCONFIG_DISCOVERYPORT=${port}
NETHERMIND_NETWORKCONFIG_EXTERNALIP=${ip}
NETHERMIND_NETWORKCONFIG_FILTERPEERSBYRECENTIP=false
NETHERMIND_NETWORKCONFIG_BOOTNODES=${bootnode.trim()}
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


function genXdposCompose(machine_id, num, start_num = 1) {
  let nodes = {};
  for (let i = start_num; i < start_num + num; i++) {
    const node_name = "masternode" + i.toString();
    const volume = "./xdcchain" + i.toString() + ":/work/xdcchain";
    const compose_profile = "machine" + machine_id.toString();
    const port = 20302 + i;
    const rpcport = 8544 + i;
    const wsport = 9554 + i;
    const port_mappings = [
      `${port}:${port}/tcp`,
      `${port}:${port}/udp`,
      `${rpcport}:${rpcport}/tcp`,
      `${rpcport}:${rpcport}/udp`,
      `${wsport}:${wsport}/tcp`,
      `${wsport}:${wsport}/udp`,
    ];

    if (isNethermindNode(i)) {
      // Nethermind validator: config via masternode<i>nmc.env (NETHERMIND_*)
      // + shared xdc-nmc.json; uses chainspec.json instead of genesis.json.
      // injectNetworkConfig() adds the bridge networks/ipv4_address block.
      nodes[node_name] = {
        image: `${config.xdpos.nethermind}`,
        volumes: [
          volume,
          "./chainspec.json:/work/chainspec.json",
          "./xdc-nmc.json:/work/xdc-nmc.json",
          "./bootnodes.list:/work/bootnodes.list",
        ],
        restart: "always",
        env_file: [`masternode${i}nmc.env`],
        command: [
          "--config=/work/xdc-nmc.json",
          "--datadir=/work/xdcchain",
          "--log=debug",
        ],
        profiles: [compose_profile],
        ports: port_mappings,
      };
    } else {
      // Go XDPoS masternode (default).
      nodes[node_name] = {
        image: `${config.xdpos.xdposnode}`,
        volumes: [
          volume,
          "./genesis.json:/work/genesis.json",
          "./bootnodes.list:/work/bootnodes.list",
        ],
        restart: "always",
        network_mode: "host",
        env_file: [`masternode${i}.env`],
        profiles: [compose_profile],
        ports: port_mappings,
      };
    }
  }
  return nodes;
}

function genXdposKeys() {
  const keys = {};
  for (let i = 0; i < config.keys.subnets_addr.length; i++) {
    const key = `key${i + 1}`;
    const private_key = config.keys.subnets_pk[i];
    const address = config.keys.subnets_addr[i];
    keys[key] = {
      PrivateKey: private_key,
      "0x": address,
      short: address.replace(/^0x/i, ""),
    };
  }
  keys["Owner"] = {
    PrivateKey: config.keys.grandmaster_pk,
    "0x": config.keys.grandmaster_addr,
    short: config.keys.grandmaster_addr.replace(/^0x/i, ""),
  };
  keys["Foundation"] = {
    PrivateKey: config.xdpos.foundation_pk,
    "0x": config.xdpos.foundation_addr,
    short: config.xdpos.foundation_addr.replace(/^0x/i, ""),
  };
  if (Object.keys(keys).length !== config.num_subnet + 2) {
    // sanity check
    console.log("bad case, key length not equal number of subnets");
    console.log(Object.keys(keys).length, config.num_subnet + 1);
    console.log(keys);
    process.exit();
  }
  return keys; 
}
