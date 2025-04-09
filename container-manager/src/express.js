process.chdir(__dirname);
const fs = require("fs");
const state = require("./libs/state");
const exec = require("./libs/exec");
const path = require("path");
const ethers = require("ethers");
const consolidate = require("consolidate");
const express = require("express");
const app = express();
const PORT = 5210;
let lastCalled = Date.now();

app.engine("pug", consolidate.pug);
app.engine("html", consolidate.swig);
app.set("view engine", "html"); // Set default to HTML
app.set("json spaces", 2);
app.use(express.static(path.join(__dirname, "public")));
app.use(
  express.urlencoded({
    extended: true,
  })
);
app.use(express.json());

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "views", "index.html"));
});

app.get("/debug", (req, res) => {
  res.sendFile(path.join(__dirname, "views", "debug.html"));
});

app.get("/state", async (req, res) => {
  console.log("/state called");
  const thisCall = Date.now();
  console.log("time form last call: ", thisCall - lastCalled);
  lastCalled = thisCall;
  const response = await state.getState();
  res.setHeader("Content-Type", "application/json");
  res.send(JSON.stringify(response, null, 2));
});

app.get("/start_subnet", async (req, res) => {
  console.log("/start_subnet called");
  await exec.startComposeProfile("machine1", setupRes(req, res));
});

app.get("/start_subnet_slow", async (req, res) => {
  console.log("/start_subnet_slow called");
  await exec.startSubnet("machine1", setupRes(req, res));
});

app.get("/deploy_csc_lite", async (req, res) => {
  console.log("/deploy_csc_lite called");
  await exec.deployCSC("lite", setupRes(req, res));
});
app.get("/deploy_csc_full", async (req, res) => {
  console.log("/deploy_csc_full called");
  await exec.deployCSC("full", setupRes(req, res));
});
app.get("/deploy_csc_reversefull", async (req, res) => {
  console.log("/deploy_csc_reversefull called");
  await exec.deployCSC("reversefull", setupRes(req, res));
});

app.get("/deploy_zero", async (req, res) => {
  console.log("/deploy_zero called");
  await exec.deployZero(setupRes(req, res));
});

app.get("/deploy_subswap", async (req, res) => {
  console.log("/deploy_subswap called");
  await exec.deploySubswap(setupRes(req, res));
});

app.get("/start_services", async (req, res) => {
  console.log("/start_services called");
  await exec.startComposeProfile("services", setupRes(req, res));
});

app.get("/stop_services", async (req, res) => {
  console.log("/stop_services called");
  const callbacks = setupRes(req, res);
  await exec.stopComposeProfile("services", callbacks);
});

app.get("/stop_subnet", async (req, res) => {
  console.log("/stop_subnet called");
  const callbacks = setupRes(req, res);
  await exec.stopComposeProfile("machine1", callbacks);
});

app.get("/remove_subnet", async (req, res) => {
  console.log("/remove_subnet called");
  const callbacks = setupRes(req, res);
  await exec.stopComposeProfile("machine1", callbacks);
});

// generator methods (also pug instead of html)
app.get("/gen", (req, res) => {
  res.render("generator/index.pug", {});
});

app.post("/submit", (req, res) => {
  console.log("/submit called");
  const [valid, genOut] = exec.generate(req.body);

  if (!valid) {
    res.render("generator/submit.pug", {
      message: "failed, please try again",
      error: genOut,
    });
  } else {
    res.render("generator/submit.pug", {
      message:
        "Config generation success, please continue in the Deployment Wizard tab",
    });
  }
});

app.post("/submit_preconfig", (req, res) => {
  console.log("/submit called");
  const [valid, genOut] = exec.generate(req.body);

  if (!valid) {
    res.send("failed to generate");
  } else {
    res.send("success");
  }
});

app.get("/address", (req, res) => {
  const randomWallet = ethers.Wallet.createRandom();
  res.json({
    publicKey: randomWallet.address,
    privateKey: randomWallet.privateKey,
  });
});

// add method to create env with pk, then faucet wallet will create from that file
app.get("/faucet", (req, res) => {
  res.render("faucet/index.pug", {});
});

app.get("/faucet_subnet", async function (req, res) {
  console.log("/faucet_subnet called");
  console.log(req.query);
  try {
    const { subnetUrl, gmKey } = state.getFaucetParams();
    const provider = new ethers.JsonRpcProvider(subnetUrl);
    const fromWallet = new ethers.Wallet(gmKey, provider);
    const fromPK = "123";
    toAddress = req.query.dest;
    amount = req.query.amount;
    if (!ethers.isAddress(toAddress))
      throw Error("Invalid destination address");
    if (isNaN(Number(amount)) || parseFloat(amount) <= 0 || amount == "")
      throw Error("Invalid Amount");
    if (parseFloat(amount) > 1_000_000_000)
      throw Error("Faucet request over 1,000,000,000 is not allowed");
    let inputs = ["", "", fromPK, toAddress, amount];
    const { fromBalance, toBalance, txHash } = await exec.processTransfer(
      provider,
      fromWallet,
      toAddress,
      amount
    );
    res.json({
      success: true,
      sourceAddress: fromWallet.address,
      destAddress: toAddress,
      sourceBalance: fromBalance,
      destBalance: toBalance,
      txHash: txHash,
    });
  } catch (error) {
    console.log(error);
    console.log(error.message);
    res.json({
      success: false,
      message: error.message,
    });
  }
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

function setupRes(req, res) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  const dataCallback = (data) => {
    lines = data.split("\n");
    for (let l = 0; l < lines.length; l++) {
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
    doneCallback: doneCallback,
  };
}
