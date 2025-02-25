const { execSync } = require('child_process');
const fs = require('fs')
const path = require('path'); 
const axios = require('axios');
const mountPath = path.join(__dirname, '../mount/generated/')
const instance = axios.create({
  socketPath: '/var/run/docker.sock',
  baseURL: "http://unix:/", 
});
const config = {}

function initModule(){
  const [found, name] = checkFiles()
  if (!found) {
    throw Error(`Incomplete mount, did not find: ${name}`)
  }
  config['compose'] = composeCommand()
}

module.exports = {
  initModule,
  getSubnetContainers,
  testAxios,
  getContainersState,
  startComposeProfile,
  deployContract,
  stopComposeProfile,
}

async function testAxios(){
  // startSubnetNodes()
  const [subnets, services] = await getContainersState()
  return {
    subnets: subnets,
    services: services
  }
}

async function getSubnetContainers() {
  const response = await instance.get('http://localhost/containers/json')
  const containers = response.data
  const filtered = []
  for(let i=0; i<containers.length; i++){
    if(containers[i].Names[0].includes('generated')){
      const c = {
        name: containers[i].Names[0].substring(1),
        image: containers[i].Image,
        state: containers[i].State,
        status: containers[i].Status,
        network: containers[i].HostConfig.NetworkMode
      }
      filtered.push(c)
    } 
  }
  return filtered
}

function checkFiles(){
  files = [
    'docker-compose.yml',
    'common.env',
    'contract_deploy.env',
    'genesis.json',
  ]
  if (!fs.existsSync(mountPath)){ //first check folder exists
    return [false, path.join(mountPath)]
  }
  for(let i=0; i<files.length; i++){
    filename = path.join(mountPath, files[i])
    if (!fs.existsSync(filename)){
      return [false, filename]
    }
  }
  return [true, '']
}

async function getContainersState(){ 
  const containers = await getSubnetContainers()
  const subnets = []
  const services = []
  for(let i=0; i<containers.length; i++){
    const [isSubnet, name] = isSubnetContainer(containers[i].name)
    const container = {
      name: name,
      state: containers[i].state
    }
    isSubnet ? subnets.push(container) : services.push(container)
  }
  return [subnets, services]
}


async function checkDeployState(){
}

function checkContractState(){

}
function checkMining(){

}
function checkPeers(){

}

function isSubnetContainer(container){
  container = container.split('-') //container name format: generated-xxxxx-1, need to extract middle string
  container.pop()
  container.shift()
  const name = container.join()
  let isSubnet = false
  if (name.includes('subnet')){
    isSubnet = true
  }
  return [isSubnet, name]
}

function composeCommand(){
  let command = ''
  let output1 = ''
  let output2 = ''
  try{
    output1 = executeCommandSync('docker compose version')
  }catch(error){

  }
  try{
    output2 = executeCommandSync('docker-compose version')
  } catch (error){

  } 
  if (output1 && output1.includes('version')){
    return 'docker compose'
  }
  if (outpu2 && output2.includes('version')){
    return 'docker-compose'
  }
  console.log('Invalid docker compose version')
  console.log('docker compose version output:', output1)
  console.log('docker-compose version output:', output2)
  throw Error("Invalid docker compose version")
}


function startComposeProfile(profile){
  const compose = config.compose
  executeCommandSync(`${compose} --profile ${profile} pull`)
  executeCommandSync(`${compose} --profile ${profile} up -d`)
}

function stopComposeProfile(profile){
  const compose = config.compose
  executeCommandSync(`${compose} --profile ${profile} down`)
}

function deployContract(){
  // docker pull xinfinorg/csc:feature-v0.3.0
  // docker run -v ${PWD}/:/app/cicd/mnt/ --network generated_docker_net xinfinorg/csc:feature-v0.3.0 full
  // need to figure what to use instead of ${PWD}, probably need host full path

  executeCommandSync(`docker pull xinfinorg/csc:feature-v0.3.0`)
  executeCommandSync(`docker run -v /Users/wp/Git/Subnet-Deployment/container-manager/mount/generated/:/app/cicd/mount/ --network generated_docker_net xinfinorg/csc:feature-v0.3.0 full`)
}


function executeCommandSync(command) {
  const pathCommand = 'cd '+mountPath+';'+'export PWD=/Users/wp/Git/Subnet-Deployment/container-manager/mount/generated;'+command
  const output = execSync(pathCommand).toString();
  console.log(`Command output: ${output}`);
  return output;
// // Example usage:
// try {
//     const output = executeCommandSync('ls -l');
//     console.log('Command output:', output);
// } catch (error) {
//     console.error('Error:', error);
// }
}

function confirmCompatible(){
  //check docker version
  //check docker compose version
  // only requirement is docker
}