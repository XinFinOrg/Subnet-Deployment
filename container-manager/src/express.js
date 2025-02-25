const docker = require("./docker");
docker.initModule()
const express = require('express');
const path = require('path'); 
const app = express();
const PORT = 3000;

// Serve static files (like CSS or JS) from a "public" directory
app.use(express.static(path.join(__dirname, 'public')));
app.set('json spaces', 2)

// Route to serve the HTML file
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'index.html'));
});

app.get('/test', async (req, res) => {
  const test = await docker.testAxios()
  res.send(JSON.stringify(test, null, 2))
})

app.get('/state', async (req, res) => {
  const state = await docker.getContainersState()
  res.send(JSON.stringify(state, null, 2))
})

app.get('/start_subnet', async (req, res) => {
  await docker.startComposeProfile('machine1')
  const state = await docker.getContainersState()
  res.send(JSON.stringify(state, null, 2))
})

app.get('/deploy_csc', async (req, res) => {
  docker.deployContract('csc')
  const state = await docker.getContainersState()
  res.send(JSON.stringify(state, null, 2))
})

app.get('/start_services', async (req, res) => {
  docker.startComposeProfile('services')
  const state = await docker.getContainersState()
  res.send(JSON.stringify(state, null, 2))
})

app.get('/stop_all', async (req, res) => {
  docker.stopComposeProfile('machine1')
  docker.stopComposeProfile('services')
  const state = await docker.getContainersState()
  res.send(JSON.stringify(state, null, 2))
})
// app.get('/generate', async (req, res) => {
//   res.send(JSON.stringify(state, null, 2))
// })

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});

function sleepSync(ms) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    // Busy-wait loop (blocks the event loop)
  }
}