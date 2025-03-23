const dotenv = require("dotenv");
const fs = require("fs");
const yaml = require("js-yaml");
const path = require("path");
const mountPath = path.join(__dirname, "../../mount/generated/");
const config = {};

module.exports = config;

initModule();

function initModule() {
  const [found, name] = checkFiles();
  if (!found) {
    throw Error(`Incomplete mount, did not find: ${name}`);
  }
  config["compose"] = getComposeCommand();

  config["hostPath"] = process.env.HOSTPWD || "";
  if (config["hostPath"] === "") {
    throw Error("Incomplete container start, did not find env: HOSTPWD");
  }
}

function checkFiles() {
  files = [
    "docker-compose.yml",
    "common.env",
    "contract_deploy.env",
    // "genesis.json",
  ];
  if (!fs.existsSync(mountPath)) {
    //first check folder exists
    return [false, path.join(mountPath)];
  }
  for (let i = 0; i < files.length; i++) {
    filename = path.join(mountPath, files[i]);
    if (!fs.existsSync(filename)) {
      return [false, filename];
    }
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
