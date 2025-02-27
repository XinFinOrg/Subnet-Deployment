const exec = require("child_process").exec;
const path = require("path");
const mountPath = path.join(__dirname, "../../mount/generated/");
const config = require("./config");

module.exports = {
  startComposeProfile,
  stopComposeProfile,
  deployContract,
  executeTest,
};

const streamExecOutput = (data) => {
  console.log(data);
};

const doneExec = () => {
  console.log("Execute Done!!");
};

async function startComposeProfile(profile) {
  await execute(
    `${config.compose} --profile ${profile} pull`,
    streamExecOutput,
    doneExec
  );
  await execute(
    `${config.compose} --profile ${profile} up -d`,
    streamExecOutput,
    doneExec
  );
  return {};
}

async function stopComposeProfile(profile) {
  await execute(
    `${config.compose} --profile ${profile} down`,
    streamExecOutput,
    doneExec
  );
  return {};
}

async function deployContract() {
  // docker pull xinfinorg/csc:feature-v0.3.0
  // docker run -v ${PWD}/:/app/cicd/mnt/ --network generated_docker_net xinfinorg/csc:feature-v0.3.0 full
  // need to figure what to use instead of ${PWD}, probably need host full path

  await execute(
    `docker pull xinfinorg/csc:feature-v0.3.0`,
    streamExecOutput,
    doneExec
  ); //TODO: pass version from some global conf or env
  await execute(
    `docker run -v ${config.hostPath}/generated/:/app/cicd/mount/ --network docker_net xinfinorg/csc:feature-v0.3.0 full`,
    streamExecOutput,
    doneExec
  ); //TODO: use detected network name
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
    "cd " +
    mountPath +
    ";" +
    "export PWD=/Users/wp/Git/Subnet-Deployment/container-manager/mount/generated;" +
    command;

  const prom = new Promise((resolve, reject) => {
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
