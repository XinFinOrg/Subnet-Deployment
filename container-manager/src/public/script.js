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
      // console.log(data)
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

async function generate1(network){
  console.log('generate1')
  key = await genAddress()
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
    'parentnet-wallet-pk': key.privateKey,
    rmradio: 'rm-radio-full',
    'parentnet-zero-wallet-pk': '',
    zmradio: 'zm-radio-one',
    'subnet-wallet-pk': '',
    'subnet-zero-wallet-pk': ''
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

async function generate3(network){
  console.log('generate3')
  parentnetWallet = await genAddress()
  parentnetZeroWallet = await genAddress()
  subnetWallet = await genAddress()
  subnetZeroWallet = await genAddress()
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
    pnradio: `pn-radio-${network}`,
    'parentnet-wallet-pk': parentnetWallet.privateKey,
    rmradio: 'rm-radio-full',
    'xdczero-checkbox': 'on',
    'parentnet-zero-wallet-pk': parentnetZeroWallet.privateKey,
    zmradio: 'zm-radio-bi',
    'subnet-wallet-pk': subnetWallet.privateKey,
    'subnet-zero-wallet-pk': subnetZeroWallet.privateKey,
    'subswap-checkbox': 'on'
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
  console.log(data)
  if (data.deployState != 'NONE'){
    // const genButton = document.getElementById("gen_button")
    // genButton.disabled = true
    disableButtons('gen-button')
    showAddresses(data.addressState) 
  }
}

function disableButtons(className){
  const elements = document.querySelectorAll(`.${className}`);
  elements.forEach(element => {
    // element.style.display = 'block';
    element.disabled = true
  });
}

function showAddresses(addresses){
  const parentnetWallet = document.getElementById("parentnet-wallet")
  const parentnetZeroWallet = document.getElementById("parentnet-zero-wallet")
  const subnetWallet = document.getElementById("subnet-wallet")
  const subnetZeroWallet = document.getElementById("subnet-zero-wallet")

  if (addresses.parentnetWallet !== ""){
    parentnetWallet.textContent = 'Relayer Parentnet Wallet: '+addresses.parentnetWallet
  } else {
    parentnetWallet.textContent = ""
  }
  if (addresses.parentnetZeroWallet !== ""){
    parentnetZeroWallet.textContent = 'Relayer Parentnet Zero Wallet: '+addresses.parentnetZeroWallet
  } else {
    parentnetZeroWallet.textContent = ""
  }
  if (addresses.subnetWallet !== ""){
    subnetWallet.textContent = 'Relayer Subnet Wallet'+addresses.subnetWallet
  } else {
    subnetWallet.textContent = ""
  }
  if (addresses.subnetZeroWallet !== ""){
    subnetZeroWallet.textContent = 'Relayer Subnet Zero Wallet'+addresses.subnetZeroWallet
  } else {
    subnetZeroWallet.textContent = ""
  }
}

async function fetchLoop(){
  await callStateApi('/state', 'state')
  setInterval(()=>{
    callStateApi('/state', 'state')
  }, 5000)
}