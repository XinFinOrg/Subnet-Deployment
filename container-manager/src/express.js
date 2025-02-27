const state = require("./libs/state");
const exec = require("./libs/exec");
const path = require("path");
const express = require("express");
const app = express();
const PORT = 3000;

app.use(express.static(path.join(__dirname, "public")));
app.set("json spaces", 2);

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "views", "index.html"));
});

app.get("/test", async (req, res) => {
  const response = await state.checkMining();
  console.log(response);
  res.setHeader("Content-Type", "application/json");
  res.send(JSON.stringify(response, null, 2));
});

app.get("/state", async (req, res) => {
  // const response = await state.getContainersState()
  const response = await state.getSubnetContainers();
  res.setHeader("Content-Type", "application/json");
  res.send(JSON.stringify(response, null, 2));
});

app.get("/start_subnet", async (req, res) => {
  await exec.startComposeProfile("machine1");
  const response = await docker.getContainersState();
  res.setHeader("Content-Type", "application/json");
  res.send(JSON.stringify(response, null, 2));
});

app.get("/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  let counter = 0;
  const interval = setInterval(() => {
    counter++;
    res.write(`data: Event ${counter}\n\n`);
    if (counter >= 5) {
      clearInterval(interval);
      res.write("event: close\ndata: Connection closed by server\n\n");
      res.end();
    }
  }, 1000);

  // Handle client disconnect
  req.on("close", () => {
    clearInterval(interval);
    res.end();
  });
});

app.get("/stream", async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  await exec.executeTest(
    "",
    (data) => {
      res.write(`data:${data}\n\n`);
    },
    () => {
      res.write("event: close\ndata: Connection closed by server\n\n");
      res.end();
    }
  );

  // Handle client disconnect
  req.on("close", () => {
    res.end();
  });
});

app.get("/deploy_csc", async (req, res) => {
  exec.deployContract("csc");
  const response = await docker.getContainersState();
  res.setHeader("Content-Type", "application/json");
  res.send(JSON.stringify(response, null, 2));
});

app.get("/start_services", async (req, res) => {
  exec.startComposeProfile("services");
  const response = await docker.getContainersState();
  res.setHeader("Content-Type", "application/json");
  res.send(JSON.stringify(response, null, 2));
});

app.get("/stop_all", async (req, res) => {
  exec.stopComposeProfile("machine1");
  exec.stopComposeProfile("services");
  const response = await docker.getContainersState();
  res.setHeader("Content-Type", "application/json");
  res.send(JSON.stringify(response, null, 2));
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
