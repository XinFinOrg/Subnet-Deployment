const dotenv = require("dotenv");
const fs = require("fs");
const yaml = require("js-yaml");
const path = require("path");
const mountPath = path.join(__dirname, "../../mount/generated/");
const configModule = require("../gen/config_gen.js")
const version = configModule.config.version
const config = {};

module.exports = config;

initModule();

function initModule() {
  const [found, name] = checkMountPath();
  if (!found) {
    throw Error(`Incomplete mount, did not find: ${name}`);
  }
  config["compose"] = getComposeCommand();

  config["hostPath"] = process.env.HOSTPWD || "";
  if (config["hostPath"] === "") {
    throw Error("Incomplete container start, did not find env: HOSTPWD");
  }
  console.log('init with versions', version)
  config["version"] = version
}

function checkMountPath() {
  const shouldExistMount = path.join(mountPath, 'scripts')
  if (!fs.existsSync(shouldExistMount)) {
    //first check folder exists
    return [false, shouldExistMount];
  }
  return [true, ""];
}

function getComposeCommand() {
  return "docker compose"; //bypass TODO:
  let command = "";
  let output1 = "";
  let output2 = "";
  try {
    output1 = executeCommandSync("docker compose version");
  } catch (error) {}
  try {
    output2 = executeCommandSync("docker-compose version");
  } catch (error) {}
  if (output1 && output1.includes("version")) {
    return "docker compose";
  }
  if (output2 && output2.includes("version")) {
    return "docker-compose";
  }
  console.log("Invalid docker compose version");
  console.log("docker compose version output:", output1);
  console.log("docker-compose version output:", output2);
  throw Error("Invalid docker compose version");
}
