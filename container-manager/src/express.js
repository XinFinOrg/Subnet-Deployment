const state = require("./libs/state");
const exec = require("./libs/exec");
const path = require("path");
const express = require("express");
const app = express();
const PORT = 5210;
let lastCalled = Date.now()

app.use(express.static(path.join(__dirname, "public")));
app.set("json spaces", 2);

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

// app.get('/generate', async (req, res) => {
//   res.send(JSON.stringify(state, null, 2))
// })

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