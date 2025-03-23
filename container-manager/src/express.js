process.chdir(__dirname);
const fs = require("fs");
const state = require("./libs/state");
const exec = require("./libs/exec");
const { execSync } = require("child_process");
const path = require("path");
const ethers = require('ethers');
const consolidate = require('consolidate');
const express = require("express");
const app = express();
const PORT = 5210;
let lastCalled = Date.now()

app.engine('pug', consolidate.pug);
app.engine('html', consolidate.swig);
app.set('view engine', 'html'); // Set default to HTML
app.set("json spaces", 2);
app.use(express.static(path.join(__dirname, "public")));
app.use(express.urlencoded({
  extended: true
})) 

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "views", "index.html"));
});

app.get("/state", async (req, res) => {
  console.log("/state called");
  const thisCall = Date.now()
  console.log("time form last call: ", thisCall-lastCalled)
  lastCalled = thisCall
  const response = await state.getState();
  res.setHeader("Content-Type", "application/json");
  res.send(JSON.stringify(response, null, 2));
});

app.get("/start_subnet", async (req, res) => {
  console.log("/start_subnet called")
  await exec.startComposeProfile("machine1", setupRes(req,res));
});

app.get("/start_subnet_slow", async (req, res) => {
  console.log("/start_subnet_slow called")
  await exec.startSubnet("machine1", setupRes(req,res));
});

app.get("/deploy_csc", async (req, res) => {
  console.log("/deploy_csc called");
  await exec.deployCSC(setupRes(req,res));
});

app.get("/start_services", async (req, res) => {
  console.log("/start_services called")
  await exec.startComposeProfile("services", setupRes(req,res));
});

app.get("/stop_services", async (req, res) => {
  console.log("/stop_services called")
  const callbacks = setupRes(req,res)
  await exec.stopComposeProfile("services", callbacks);
});

app.get("/stop_subnet", async (req, res) => {
  console.log("/stop_subnet called")
  const callbacks = setupRes(req,res)
  await exec.stopComposeProfile("machine1", callbacks);
});

app.get("/remove_subnet", async (req, res) => {
  console.log("/remove_subnet called")
  const callbacks = setupRes(req,res)
  await exec.stopComposeProfile("machine1", callbacks);
});

//
// generator methods (also pug instead of html)
app.get("/gen", (req, res) => {
  res.render("generator/index.pug", {
  });
});

app.post("/submit", (req, res) => {
  console.log("/submit called")
  gen_env = genGenEnv(req.body)

  fs.writeFileSync(path.join(__dirname, "/gen/gen.env"), gen_env, (err) => {
    if (err) {
      console.error(err);
      exit();
    }
  });
  [valid, genOut] = callExec(`cd gen; node gen.js`);

  console.log()
  console.log(genOut)
  
  if (!valid){
    res.render("generator/submit.pug", { message: "failed, please try again", error: genOut })
    return
  }

  res.render("generator/submit.pug", { message: "Config generation success, please continue in the Deployment Wizard tab" });
});

app.get("/address", (req,res) => {
  const randomWallet = ethers.Wallet.createRandom()
  res.json({
    "publicKey": randomWallet.address,
    "privateKey": randomWallet.privateKey
  });
})
 
// add method to create env with pk, then faucet wallet will create from that file 
app.get("/faucet", (req, res) => {
  res.render("faucet/index.pug", {
  });
});


app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});

function sleepSync(ms) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    // Busy-wait loop (blocks the event loop)
  }
}

function setupRes(req,res){
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  const dataCallback = (data) => {
    lines = data.split('\n')
    for(let l=0;l<lines.length;l++){
      res.write(`data:${lines[l]}\n\n`);
    }
  };
  const doneCallback = () => {
    res.write("event: close\ndata: Done\n\n");
    res.end();
  };
  req.on("close", () => {
    res.end();
  });
  return {
    dataCallback: dataCallback,
    doneCallback: doneCallback
  }
}

function callExec(command) {
  try {
    const stdout = execSync(command, { timeout: 200000, encoding: 'utf-8'});
    output = stdout.toString();
    // console.log(output);
    return [true, output]
  } catch (error) {
    // console.log(error)
    return [false, error.stdout]
    throw Error(error.stdout);
  }
}

function genGenEnv(input){
  console.log(input)

  let content_machine = ''
  if (input["text-num-machine"] > 1){
    content_machine += `\nMAIN_IP=${input["text-private-ip"]}`
    if (input["text-public-ip"] != ''){
      content_machine += `\nPUBLIC_IP=${input["text-public-ip"]}`  
    }
    if (input["text-num-machine"] != ''){
      content_machine += `\nNUM_MACHINE=${input["text-num-machine"]}`
    }
  } else {
    content_machine += `\nMAIN_IP=127.0.0.1`
    content_machine += `\nNUM_MACHINE=1`
  }

  let parentnet = ''
  switch (input.pnradio){
    case 'pn-radio-testnet':
      parentnet = 'testnet'
      break
    case 'pn-radio-devnet':
      parentnet = 'devnet'
      break
    case 'pn-radio-mainnet':
      parentnet = 'mainnet'
      break
  }

  let relayer_mode = ''
  switch (input.rmradio){
    case 'rm-radio-full':
      relayer_mode = 'full'
      break
    case 'rm-radio-lite':
      relayer_mode = 'lite'
      break
  }

  let content_custom_key = ''
  if (input["grandmaster-pk"] != ''){
    content_custom_key += `\nGRANDMASTER_PK=${input["grandmaster-pk"]}`
  }

  let subnet_keys=[]
  let idx = 1
  while ('subnet-key'+idx.toString() in input){
    key = 'subnet-key'+idx.toString()
    subnet_keys.push(input[key])
    idx++
  }
  if (subnet_keys.length > 0){
    key_string = subnet_keys.join(',')
    content_custom_key += `\nSUBNETS_PK=${key_string}`
  }

  let content_version = ''
  if (input["customversion-subnet"] != ''){
    content_version += `\nVERSION_SUBNET=${input["customversion-subnet"]}`
  }
  if (input["customversion-bootnode"] != ''){
    content_version += `\nVERSION_BOOTNODE=${input["customversion-bootnode"]}`
  }
  if (input["customversion-relayer"] != ''){
    content_version += `\nVERSION_RELAYER=${input["customversion-relayer"]}`
  }
  if (input["customversion-stats"] != ''){
    content_version += `\nVERSION_STATS=${input["customversion-stats"]}`
  }
  if (input["customversion-frontend"] != ''){
    content_version += `\nVERSION_FRONTEND=${input["customversion-frontend"]}`
  }
  if (input["customversion-csc"] != ''){
    content_version += `\nVERSION_CSC=${input["customversion-csc"]}`
  }
  if (input["customversion-zero"] != ''){
    content_version += `\nVERSION_ZERO=${input["customversion-zero"]}`
  }

  let content_zero = ''
  if (relayer_mode == 'full' && 'xdczero-checkbox' in input){
    if (input["zmradio"] == 'zm-radio-one'){
      content_zero += '\nXDC_ZERO=one-directional'
    }
    if (input["zmradio"] == 'zm-radio-bi'){
      content_zero += '\nXDC_ZERO=bi-directional'
      content_zero += `\nSUBNET_WALLET_PK=${input["subnet-wallet-pk"]}`
      content_zero += `\nSUBNET_ZERO_WALLET_PK=${input["subnet-zero-wallet-pk"]}` 
    }
    content_zero += `\nPARENTNET_ZERO_WALLET_PK=${input["parentnet-zero-wallet-pk"]}`
    if ('subswap-checkbox' in input){
      content_zero += '\nSUBSWAP=true'
    }
  }

  content=`
NETWORK_NAME=${input["text-subnet-name"]}
NUM_SUBNET=${input["text-num-subnet"]}
PARENTNET=${parentnet}
PARENTNET_WALLET_PK=${input["parentnet-wallet-pk"]}
RELAYER_MODE=${relayer_mode}
`
  content+=content_machine
  content+='\n'
  content+=content_custom_key
  content+='\n'
  content+=content_version
  content+='\n'
  content+=content_zero

  console.log(content)

  return content
}
