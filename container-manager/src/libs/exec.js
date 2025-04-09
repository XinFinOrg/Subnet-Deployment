const exec = require("child_process").exec;
const { execSync } = require("child_process");
const path = require("path");
const mountPath = path.join(__dirname, "../../mount/generated/");
const config = require("./config");
const fs = require("fs");
const ethers = require("ethers");

module.exports = {
  startComposeProfile,
  stopComposeProfile,
  deployCSC,
  deployZero,
  deploySubswap,
  executeTest,
  startSubnetGradual,
  removeSubnet,
  generate,
  processTransfer,
};

const streamExecOutput = (data) => {
  console.log(data);
};

const doneExec = () => {
  console.log("Execute Done!!");
};

async function startComposeProfile(profile, callbacks) {
  await execute(
    `${config.compose} --profile ${profile} pull;\n` +
      `${config.compose} --profile ${profile} up -d;\n`,
    callbacks.dataCallback,
    callbacks.doneCallback
  );
  return {};
}

async function startSubnetGradual(profile, callbacks) {
  await execute(
    `${config.compose} --profile machine1 pull;\n` +
      `${config.compose} --profile machine1 up -d subnet1;\n` +
      `sleep 10;\n` +
      `${config.compose} --profile machine1 up -d subnet2;\n` +
      `sleep 10;\n` +
      `${config.compose} --profile machine1 up -d subnet3;\n` +
      `sleep 10;\n` +
      `${config.compose} --profile machine1 up -d bootnode;\n`,
    callbacks.dataCallback,
    callbacks.doneCallback
  );
  return {};
}

async function stopComposeProfile(profile, callbacks) {
  await execute(
    `${config.compose} --profile ${profile} down`,
    callbacks.dataCallback,
    callbacks.doneCallback
  );
  return {};
}

async function removeSubnet(profile, callbacks) {
  await execute(
    `${config.compose} --profile ${profile} down; rm -rf xdcchain*`,
    callbacks.dataCallback,
    callbacks.doneCallback
  );
}

async function deployCSC(mode, callbacks) {
  if (!["lite", "full", "reversefull"].includes(mode)) {
    console.error("invalid csc mode", mode);
    return {};
  }

  await execute(
    `docker pull xinfinorg/csc:${config.version.csc};\n` +
      `docker run -v ${config.hostPath}/:/app/cicd/mount/ --network docker_net xinfinorg/csc:${config.version.csc} ${mode}`,
    callbacks.dataCallback,
    callbacks.doneCallback
  );

  return {};
}

async function deploySubswap(callbacks) {
  await execute(
    `docker pull xinfinorg/xdc-zero:${config.version.zero};\n` +
      `docker run -v ${config.hostPath}/:/app/cicd/mount/ --network docker_net xinfinorg/xdc-zero:${config.version.zero} zeroandsubswap`,
    callbacks.dataCallback,
    callbacks.doneCallback
  );

  return {};
}

async function deployZero(callbacks) {
  await execute(
    `docker pull xinfinorg/xdc-zero:${config.version.zero};\n` +
      `docker run -v ${config.hostPath}/:/app/cicd/mount/ --network docker_net xinfinorg/xdc-zero:${config.version.zero} endpointandregisterchain`,
    callbacks.dataCallback,
    callbacks.doneCallback
  );

  return {};
}

async function executeTest(command, outputHandler, doneHandler) {
  command =
    "echo $RANDOM; sleep 1; echo $RANDOM; sleep 1; echo a; sleep 1; echo b; sleep 1; echo c; sleep 1; echo d; sleep 1; echo e; sleep 1; echo f";
  execute(command, outputHandler, doneHandler);
}

async function execute(command, outputHandler, doneHandler) {
  console.log("executing", command);
  const pathCommand =
    `cd ${mountPath};\n` + `export PWD=${config.hostPath};\n` + `${command}`;

  const prom = new Promise((resolve, reject) => {
    outputHandler(pathCommand);
    const execProcess = exec(pathCommand);

    execProcess.stdout.on("data", (data) => {
      outputHandler(data.toString());
      // process.stdout.write(data.toString());
    });
    execProcess.stderr.on("data", (data) => {
      console.error(data.toString());
      outputHandler(data.toString());
    });
    execProcess.on("error", (err) => {
      console.error("Failed to start exec process:", err.message);
      doneHandler();
      reject(err); // Reject the Promise on error
    });
    execProcess.on("close", (code) => {
      console.log(`Exec process exited with code ${code}`);
      doneHandler();
      resolve(code); // Resolve the Promise on close
    });
  });

  return prom;
}

function generate(params) {
  genEnv = genGenEnv(params);
  fs.writeFileSync(path.join(mountPath, "gen.env"), genEnv, (err) => {
    //write to mount
    if (err) {
      console.error(err);
      exit();
    }
  });

  let command = `cd ${__dirname}/../gen; node gen.js`;
  console.log(command);
  const [result, out] = callExec(command);
  if (!result) {
    return [result, out];
  }
  console.log("gen success");
  command = `cd ${mountPath}; docker run -v ${config.hostPath}:/app/generated/ --entrypoint 'bash' xinfinorg/xdcsubnets:${config.version.genesis} /work/puppeth.sh`;
  console.log(command);
  const [result2, out2] = callExec(command);
  return [result2, out2];
}

function callExec(command) {
  try {
    const stdout = execSync(command, { timeout: 200000, encoding: "utf-8" });
    output = stdout.toString();

    // console.log(output);
    return [true, output];
  } catch (error) {
    console.log(error);
    return [false, error.stdout];
    throw Error(error.stdout);
  }
}

function genGenEnv(input) {
  console.log(input);

  let content_machine = "";
  if (input["text-num-machine"] > 1) {
    content_machine += `\nMAIN_IP=${input["text-private-ip"]}`;
    if (input["text-public-ip"] != "") {
      content_machine += `\nPUBLIC_IP=${input["text-public-ip"]}`;
    }
    if (input["text-num-machine"] != "") {
      content_machine += `\nNUM_MACHINE=${input["text-num-machine"]}`;
    }
  } else {
    content_machine += `\nMAIN_IP=127.0.0.1`;
    content_machine += `\nNUM_MACHINE=1`;
  }

  let parentnet = "";
  switch (input.pnradio) {
    case "pn-radio-testnet":
      parentnet = "testnet";
      break;
    case "pn-radio-devnet":
      parentnet = "devnet";
      break;
    case "pn-radio-mainnet":
      parentnet = "mainnet";
      break;
  }

  let relayer_mode = "";
  switch (input.rmradio) {
    case "rm-radio-full":
      relayer_mode = "full";
      break;
    case "rm-radio-lite":
      relayer_mode = "lite";
      break;
  }

  let content_custom_key = "";
  if (input["grandmaster-pk"] != "") {
    content_custom_key += `\nGRANDMASTER_PK=${input["grandmaster-pk"]}`;
  }

  let subnet_keys = [];
  let idx = 1;
  while ("subnet-key" + idx.toString() in input) {
    key = "subnet-key" + idx.toString();
    subnet_keys.push(input[key]);
    idx++;
  }
  if (subnet_keys.length > 0) {
    key_string = subnet_keys.join(",");
    content_custom_key += `\nSUBNETS_PK=${key_string}`;
  }

  let content_version = "";
  if (input["customversion-subnet"] != "") {
    content_version += `\nVERSION_SUBNET=${input["customversion-subnet"]}`;
  }
  if (input["customversion-bootnode"] != "") {
    content_version += `\nVERSION_BOOTNODE=${input["customversion-bootnode"]}`;
  }
  if (input["customversion-relayer"] != "") {
    content_version += `\nVERSION_RELAYER=${input["customversion-relayer"]}`;
  }
  if (input["customversion-stats"] != "") {
    content_version += `\nVERSION_STATS=${input["customversion-stats"]}`;
  }
  if (input["customversion-frontend"] != "") {
    content_version += `\nVERSION_FRONTEND=${input["customversion-frontend"]}`;
  }
  if (input["customversion-csc"] != "") {
    content_version += `\nVERSION_CSC=${input["customversion-csc"]}`;
  }
  if (input["customversion-zero"] != "") {
    content_version += `\nVERSION_ZERO=${input["customversion-zero"]}`;
  }

  let content_zero = "";
  if (relayer_mode == "full" && "xdczero-checkbox" in input) {
    if (input["zmradio"] == "zm-radio-one") {
      content_zero += "\nXDC_ZERO=one-directional";
    }
    if (input["zmradio"] == "zm-radio-bi") {
      content_zero += "\nXDC_ZERO=bi-directional";
      content_zero += `\nSUBNET_WALLET_PK=${input["subnet-wallet-pk"]}`;
      content_zero += `\nSUBNET_ZERO_WALLET_PK=${input["subnet-zero-wallet-pk"]}`;
    }
    content_zero += `\nPARENTNET_ZERO_WALLET_PK=${input["parentnet-zero-wallet-pk"]}`;
    if ("subswap-checkbox" in input) {
      content_zero += "\nSUBSWAP=true";
    }
  }

  content = `
NETWORK_NAME=${input["text-subnet-name"]}
NUM_SUBNET=${input["text-num-subnet"]}
PARENTNET=${parentnet}
PARENTNET_WALLET_PK=${input["parentnet-wallet-pk"]}
RELAYER_MODE=${relayer_mode}
`;
  content += content_machine;
  content += "\n";
  content += content_custom_key;
  content += "\n";
  content += content_version;
  content += "\n";
  content += content_zero;

  console.log(content);

  return content;
}

async function processTransfer(provider, fromWallet, toAddress, amount) {
  // fromPK = inputs[2];
  // toAddress = inputs[3];
  // amount = inputs[4];
  // const provider = new ethers.JsonRpcProvider(subnetURL);
  // const fromWallet = new ethers.Wallet(fromPK, provider);
  let tx = {
    to: toAddress,
    value: ethers.parseEther(amount),
  };

  try {
    await provider._detectNetwork();
  } catch (error) {
    throw Error("Cannot connect to RPC");
  }

  let sendPromise = fromWallet.sendTransaction(tx);
  txHash = await sendPromise.then((tx) => {
    return tx.hash;
  });
  console.log("TX submitted, confirming TX execution, txhash:", txHash);

  let receipt;
  let count = 0;
  while (!receipt) {
    count++;
    // console.log("tx receipt check loop", count);
    if (count > 60) {
      throw Error("Timeout: transaction did not execute after 60 seconds");
    }
    await sleep(1000);
    let receipt = await provider.getTransactionReceipt(txHash);
    if (receipt && receipt.status == 1) {
      console.log("Successfully transferred", amount, "subnet token");
      let fromBalance = await provider.getBalance(fromWallet.address);
      fromBalance = ethers.formatEther(fromBalance);
      let toBalance = await provider.getBalance(toAddress);
      toBalance = ethers.formatEther(toBalance);
      console.log("Current balance");
      console.log(`${fromWallet.address}: ${fromBalance}`);
      console.log(`${toAddress}: ${toBalance}`);
      return {
        fromBalance: fromBalance,
        toBalance: toBalance,
        txHash: txHash,
      };
    }
  }
}

function findENVInFile(env, filepath) {
  const envFileContent = fs.readFileSync(filepath, "utf8");
  const regex = new RegExp(`^${env}=.*`, "gm");
  let matches = envFileContent.match(regex);
  matches = matches === null ? [] : matches;
  return matches;
}
