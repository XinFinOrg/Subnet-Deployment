const axios = require('axios');
const instance = axios.create({
  socketPath: '/var/run/docker.sock',
  baseURL: "http://unix:/", 
});


module.exports = {
  getSubnetContainers,
  getContainersState,
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
function confirmCompatible(){
  //check docker version
  //check docker compose version
  // only requirement is docker
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
