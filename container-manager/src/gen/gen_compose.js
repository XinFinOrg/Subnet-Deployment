const net = require("net");
const configModule = require("./config_gen");
const config = configModule.config;
Object.freeze(config);

module.exports = {
  genSubnetNodes,
  genBootNode,
  genServices,
  injectNetworkConfig,
  genSubswapFrontend,
  genExplorer,
};

function genSubnetNodes(machine_id, num, start_num = 1) {
  let subnet_nodes = {};
  for (let i = start_num; i < start_num + num; i++) {
    const node_name = "subnet" + i.toString();
    const volume = "${HOSTPWD}/xdcchain" + i.toString() + ":/work/xdcchain";
    const config_path = "subnet" + i.toString() + ".env";
    const compose_profile = "machine" + machine_id.toString();
    const port = 20302 + i;
    const rpcport = 8544 + i;
    const wsport = 9554 + i;
    subnet_nodes[node_name] = {
      image: `xinfinorg/xdcsubnets:${config.version.subnet}`,
      volumes: [volume, "${HOSTPWD}/genesis.json:/work/genesis.json"],
      restart: "always",
      network_mode: "host",
      env_file: [config_path],
      profiles: [compose_profile],
      ports: [
        `${port}:${port}/tcp`,
        `${port}:${port}/udp`,
        `${rpcport}:${rpcport}/tcp`,
        `${rpcport}:${rpcport}/udp`,
        `${wsport}:${wsport}/tcp`,
        `${wsport}:${wsport}/udp`,
      ],
    };
  }
  return subnet_nodes;
}

function genBootNode(machine_id) {
  let config_path = "common.env";
  const machine = "machine" + machine_id.toString();
  const bootnode = {
    image: `xinfinorg/xdcsubnets:${config.version.bootnode}`,
    restart: "always",
    env_file: config_path,
    volumes: ["${HOSTPWD}/bootnodes:/work/bootnodes"],
    entrypoint: ["bash", "/work/start-bootnode.sh"],
    command: ["-verbosity", "6", "-nodekey", "bootnode.key"],
    ports: ["20301:20301/tcp", "20301:20301/udp"],
    profiles: [machine],
  };
  return bootnode;
}

function genServices(machine_id) {
  const config_path = "common.env";
  const machine = "services";
  const volume_path = "${HOSTPWD}" + "/" + config_path;
  const frontend = {
    image: `xinfinorg/subnet-frontend:${config.version.frontend}`,
    restart: "always",
    env_file: config_path, // not used directly (injected via volume) but required to trigger restart if common.env changes
    volumes: [`${volume_path}:/app/.env.local`],
    ports: ["5214:5214"],
    profiles: [machine],
  };
  const relayer = {
    image: `xinfinorg/xdc-relayer:${config.version.relayer}`,
    restart: "always",
    env_file: config_path,
    ports: ["5215:5215"],
    profiles: [machine],
  };
  const stats = {
    image: `xinfinorg/subnet-stats-service:${config.version.stats}`,
    restart: "always",
    env_file: config_path,
    volumes: ["${HOSTPWD}/stats-service/logs:/app/logs"],
    ports: ["5213:5213"],
    profiles: [machine],
  };
  const bootnode = genBootNode(machine_id);
  // observer=genObserver(machine_id),

  const services = {
    bootnode,
    // observer,
    relayer,
    stats,
    frontend,
  };

  return services;
}

function genSubswapFrontend() {
  const subswap_frontend = {
    image: `xinfinorg/subswap-frontend:${config.version.subswap_frontend}`,
    restart: "always",
    volumes: [
      "${HOSTPWD}/subswap-frontend.config.json:/app/subswap-frontend.config.json",
    ],
    ports: ["5216:5216"],
    profiles: ["subswap"],
  };
  const subswap = {
    subswap_frontend,
  };
  return subswap;
}

function genExplorer() {
  const explorer_db = {};
  const explorer_ui = {};
  const explorer_indexer = {};

  const explorer = {
    // db: explorer_db,
    // ui: explorer_ui,
    // idx: explorer_indexer,
  };
  return explorer;
}

function injectNetworkConfig(compose_object) {
  // networks:
  //   docker_net:
  //     driver: bridge
  //     ipam:
  //       config:
  //         - subnet: 192.168.25.0/24
  const network = {
    docker_net: {
      external: true,
      driver: "bridge",
      ipam: {
        config: [{ subnet: "192.168.25.0/24" }],
      },
    },
  };
  // networks:
  //   docker_net:
  //     ipv4_address:
  //       192.168.25.10

  let record_services_ip = {};

  const ip_string_base = "192.168.25.";
  let start_ip_subnet = 11;
  let start_ip_service = 51;
  Object.entries(compose_object["services"]).forEach((entry) => {
    const [key, value] = entry;
    let component_ip;
    if (key.startsWith("subnet")) {
      component_ip = ip_string_base + parseInt(start_ip_subnet);
      start_ip_subnet += 1;
    } else {
      component_ip = ip_string_base + parseInt(start_ip_service);
      start_ip_service += 1;
    }
    if (!net.isIP(component_ip)) {
      console.log(`ERROR: found invalid IP assignment ${component_ip}`);
      process.exit(1);
    }
    const component_network = {
      docker_net: {
        ipv4_address: component_ip,
      },
    };
    compose_object["services"][key]["networks"] = component_network;
    delete compose_object["services"][key]["network_mode"];
    record_services_ip[key] = component_ip;
  });

  compose_object["networks"] = network;

  return compose_object, record_services_ip;
}
