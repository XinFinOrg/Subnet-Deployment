async function callStateApi(route, outElementId) {
  const outputDiv = document.getElementById(outElementId);
  try {
    const response = await fetch(route, { method: "GET" });
    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }
    const contentType = response.headers.get("Content-Type");
    let data;
    if (contentType && contentType.includes("application/json")) {
      data = await response.json();
      adjustStateDivs(data)
      display = data
      display = JSON.stringify(display, null, 2);
    } else {
      data = await response.text();
    }

    outputDiv.textContent = display;
  } catch (error) {
    console.error("Error:", error);
    outputDiv.textContent = "API call failed: " + error.message;
  }
}

async function generate1(network, subswap){
  console.log('generate1')
  loadingStart()
  const parentnetWallet = await genAddress()
  const parentnetZeroWallet = await genAddress()
  const subnetWallet = await genAddress()
  const subnetZeroWallet = await genAddress()
  const formData = {
    'text-subnet-name': 'myxdcsubnet',
    'text-num-subnet': '1',
    'text-num-machine': '1',
    'text-private-ip': '',
    'text-public-ip': '',
    'grandmaster-pk': '',
    'customversion-subnet': '',
    'customversion-bootnode': '',
    'customversion-relayer': '',
    'customversion-stats': '',
    'customversion-frontend': '',
    'customversion-csc': '',
    'customversion-zero': '',
    pnradio: `pn-radio-${network}`,
    'parentnet-wallet-pk': parentnetWallet.privateKey,
    rmradio: 'rm-radio-full',
    'parentnet-zero-wallet-pk': '',
    zmradio: 'zm-radio-one',
    'subnet-wallet-pk': '',
    'subnet-zero-wallet-pk': ''
  }
  if (subswap){
    formData['xdczero-checkbox'] = 'on'
    formData['parentnet-zero-wallet-pk'] = parentnetZeroWallet.privateKey
    formData['zmradio'] = 'zm-radio-bi'
    formData['subnet-wallet-pk'] = subnetWallet.privateKey
    formData['subnet-zero-wallet-pk'] = subnetZeroWallet.privateKey
    formData['subswap-checkbox'] = 'on'
  }
  const response = await fetch('/submit_preconfig',
     { method: "POST",
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(formData)
     });
  const outdiv = document.getElementById('output1')
  outdiv.textContent = await response.text()
}

async function generate3(network, subswap){
  console.log('generate3')
  loadingStart()
  const parentnetWallet = await genAddress()
  const parentnetZeroWallet = await genAddress()
  const subnetWallet = await genAddress()
  const subnetZeroWallet = await genAddress()
  const formData = {
    'text-subnet-name': 'myxdcsubnet',
    'text-num-subnet': '3',
    'text-num-machine': '1',
    'text-private-ip': '',
    'text-public-ip': '',
    'grandmaster-pk': '',
    'customversion-subnet': '',
    'customversion-bootnode': '',
    'customversion-relayer': '',
    'customversion-stats': '',
    'customversion-frontend': '',
    'customversion-csc': '',
    'customversion-zero': '',
    'pnradio': `pn-radio-${network}`,
    'parentnet-wallet-pk': parentnetWallet.privateKey,
    'rmradio': 'rm-radio-full',
  }
  if (subswap){
    formData['xdczero-checkbox'] = 'on'
    formData['parentnet-zero-wallet-pk'] = parentnetZeroWallet.privateKey
    formData['zmradio'] = 'zm-radio-bi'
    formData['subnet-wallet-pk'] = subnetWallet.privateKey
    formData['subnet-zero-wallet-pk'] = subnetZeroWallet.privateKey
    formData['subswap-checkbox'] = 'on'
  }
  const response = await fetch('/submit_preconfig',
     { method: "POST",
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(formData)
     });
  const outdiv = document.getElementById('output1')
  outdiv.textContent = await response.text()
}

async function genAddress() {
  const response = await fetch('/address', { method: "GET" });
  return response.json()
}

async function callStreamApi(route) {
  // const outputElement = document.createElement('div');
  // outputElement.className = 'output';
  loadingStart();
  collapseHistoryDivs();
  const [outputWrapper, outputElement] = createCollapsibleDiv(route);
  document.getElementById('history-text').textContent = "History:"
  document.getElementById('history').appendChild(outputWrapper);
  
  // const outputElement = document.getElementById("output");
  const eventSource = new EventSource(route);
  try {
    outputElement.textContent = "";
    eventSource.onmessage = (event) => {
      outputElement.textContent += event.data + "\n";
      outputElement.scrollTop = outputElement.scrollHeight;
    };

    eventSource.addEventListener("close", (event) => {
      outputElement.textContent += event.data + "\n";
      eventSource.close();
    });

    eventSource.onerror = () => {
      console.log("EventSource failed.");
      outputElement.textContent += "Error: Connection lost.\n";
      eventSource.close();
    };
  } catch (error) {
    console.error("Error:", error);
    outputElement.textContent = "API call failed: " + error.message;
  }
}

function createCollapsibleDiv(route){
  const newDiv = document.createElement('div');
  newDiv.className = 'output-wrapper';

  const buttonDiv = document.createElement('div')
  const command = document.createElement('button')
  command.textContent = route
  const toggleButton = document.createElement('button');
  toggleButton.className = 'toggle-button';
  toggleButton.textContent = 'Collapse';
  buttonDiv.appendChild(command)
  buttonDiv.appendChild(document.createTextNode(" "));
  buttonDiv.appendChild(toggleButton)
  newDiv.appendChild(buttonDiv);

  const contentDiv = document.createElement('div');
  contentDiv.className = 'output';
  contentDiv.style.display = 'block'; 
  newDiv.appendChild(contentDiv);

  // Add click event to the toggle button
  toggleButton.addEventListener('click', function() {
      if (contentDiv.style.display === 'none') {
          contentDiv.style.display = 'block';
          toggleButton.textContent = 'Collapse';
      } else {
          contentDiv.style.display = 'none';
          toggleButton.textContent = 'Expand';
      }
  });

  return [newDiv, contentDiv]
}

function collapseHistoryDivs(){
  const outputElements = document.getElementsByClassName('output');
  for (let element of outputElements) {
      element.style.display='none';
  }
  
  const toggleButtonElements = document.getElementsByClassName('toggle-button');
  for (let element of toggleButtonElements) {
      element.textContent = 'Expand'
  }
}

function adjustStateDivs(data){
  if (data.deployState != 'NONE'){
    disableButtons('gen-button')
    checkSubnetStarted(data.containers.subnets)
    checkServicesStarted(data.containers.services)
    showAddresses(data.requirements.addresses)
    showCopyInstruction(data.requirements.subnetConfig)
    showFaucet(data.requirements)
    unhideContractButtons(data.requirements.requireContracts)
    disableContractButtons(data.requirements.deployedContracts) 
  }

  // allowClick()
  loadingFinished()
}

function loadingFinished(){
  document.getElementById('body-wrap').style.pointerEvents = 'auto';
}

function loadingStart(){
  document.getElementById('body-wrap').style.pointerEvents = 'none';
  document.getElementById('state').textContent = 'Status: Loading...'
}

function disableButtons(className){
  const elements = document.querySelectorAll(`.${className}`);
  elements.forEach(element => {
    // element.style.display = 'block';
    element.disabled = true
  });
}

function checkSubnetStarted(subnetContainers){
  console.log(subnetContainers)
  if (subnetContainers.length == 0){
    document.getElementById("start-subnet-button").disabled = false
    document.getElementById("stop-subnet-button").disabled = true
  } else {
    document.getElementById("start-subnet-button").disabled = true
    document.getElementById("stop-subnet-button").disabled = false
  }
}

function checkServicesStarted(servicesContainers){
  if (servicesContainers.length == 0){
    document.getElementById("start-services-button").disabled = false
    document.getElementById("stop-services-button").disabled = true
  } else {
    document.getElementById("start-services-button").disabled = true
    document.getElementById("stop-services-button").disabled = false
    const ui = new URL(window.location.href);
    ui.port = "5214"
    const relayer = new URL(window.location.href);
    relayer.port = "5213"
    document.getElementById("services-details").innerHTML = `
<a href="${ui}" target="_blank">Subnet UI</a>
<br>
<a href="${relayer}" target="_blank">Relayer UI</a>
<br><br>
`
  }
}

function enableButtonClass(className){
  const elements = document.querySelectorAll(`.${className}`);
  elements.forEach(element => {
    element.disabled = false
  });
}

function unhideContractButtons(contracts){
  const cscLiteButton = document.getElementById('button-csc-lite')
  const cscFullButton = document.getElementById('button-csc-full')
  const reverseCscButton = document.getElementById('button-reverse-csc')
  // const zeroButton = document.getElementById('button-zero') //retire this concept, only subswap or no subswap
  const subswapButton = document.getElementById('button-subswap')

  if (contracts.relayer == 'lite'){
    cscLiteButton.disabled = false
    cscLiteButton.style.display = 'block'
  }
  if (contracts.relayer == 'full'){
    cscFullButton.disabled = false
    cscFullButton.style.display = 'block'
  }
  if (contracts.zero == 'bi-directional'){
    reverseCscButton.disabled = false
    reverseCscButton.style.display = 'block'
  } 
  if (contracts.subswap == 'true'){
    subswapButton.disabled = false
    subswapButton.style.display = 'block'
  }
}

function disableContractButtons(contracts){
  const cscLiteButton = document.getElementById('button-csc-lite')
  const cscFullButton = document.getElementById('button-csc-full')
  const reverseCscButton = document.getElementById('button-reverse-csc')
  const subswapButton = document.getElementById('button-subswap')

  if (contracts.csc != ""){
    cscLiteButton.disabled = true
    cscFullButton.disabled = true
  }
  if (contracts.reverseCsc != ""){
    reverseCscButton.disabled = true
  }
  if(contracts.parentnetApp != "" && contracts.subnetApp != ""){
    subswapButton.disabled = true
  }
}

function showAddresses(addresses){
  const parentnetWallet = document.getElementById("parentnet-wallet")
  const parentnetZeroWallet = document.getElementById("parentnet-zero-wallet")
  const subnetWallet = document.getElementById("subnet-wallet")
  const subnetZeroWallet = document.getElementById("subnet-zero-wallet")

  if (addresses.parentnetWallet !== ""){
    parentnetWallet.innerHTML = '&emsp;Relayer Parentnet Wallet: '+addresses.parentnetWallet
  } else {
    parentnetWallet.innerHTML = ""
  }
  if (addresses.parentnetZeroWallet !== ""){
    parentnetZeroWallet.innerHTML = '&emsp;Relayer Parentnet Zero Wallet: '+addresses.parentnetZeroWallet
  } else {
    parentnetZeroWallet.innerHTML = ""
  }
  // if (addresses.subnetWallet !== ""){
  //   subnetWallet.innerHTML = '&emsp;Relayer Subnet Wallet: '+addresses.subnetWallet
  // } else {
  //   subnetWallet.innerHTML = ""
  // }
  // if (addresses.subnetZeroWallet !== ""){
  //   subnetZeroWallet.innerHTML = '&emsp;Relayer Subnet Zero Wallet: '+addresses.subnetZeroWallet
  // } else {
  //   subnetZeroWallet.innerHTML = ""
  // }
}

function showCopyInstruction(config){
  if (config.numMachine != "" && parseInt(config.numMachine) > 1){
  const copyInstruction = document.getElementById("copy-instruction")
  copyInstruction.innerHTML =  `
Copy files docker-compose.yml, genesis.json, config/subnetX.env to other machines<br>
Then start subnet nodes on other machines:<br>
docker compose --profile machineX pull;<br>
docker compose --profile machineX up -d;<br>
`
  }
}

function showFaucet(requirements){
  if (requirements.subnetConfig.parentnet == "testnet"){
    const infoDiv = document.getElementById("mainnet-testnet-info")
    infoDiv.textContent = "3. Add Testnet balance to: "
    const testnetFaucetInfo = document.getElementById("testnet-faucet-info")
    testnetFaucetInfo.style.display = "block"
  }
  if (requirements.subnetConfig.parentnet == "mainnet"){
    const infoDiv = document.getElementById("mainnet-testnet-info")
    infoDiv.textContent = "3. Add Mainnet balance to: "

  }
  // if (requirements.addresses.subnetWallet != "" || requirements.addresses.subnetZeroWallet != ""){
  //   const subnetFaucetInfo = document.getElementById("subnet-faucet-info")
  //   subnetFaucetInfo.style.display = "block"
  // }
 

}
async function fetchLoop(){
  await callStateApi('/state', 'state')
  setInterval(()=>{
    callStateApi('/state', 'state')
  }, 5000)
}