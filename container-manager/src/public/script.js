let prevBlockNum = 0;
let prevPrevBlockNum = 0;

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
      adjustStateDivs(data);
      display = data;
      display = JSON.stringify(display, null, 2);
    } else {
      data = await response.text();
    }

    outputDiv.textContent = display;
  } catch (error) {
    console.error("Error:", error);
    outputDiv.textContent = "API call failed: " + error.message;
    loadingFinished(); // never leave the page stuck behind pointer-events:none
  }
}

async function callStreamApi(route) {
  // const outputElement = document.createElement('div');
  // outputElement.className = 'output';
  loadingStart();
  collapseHistoryDivs();
  const [outputWrapper, outputElement] = createCollapsibleDiv(route);
  document.getElementById("history-text").textContent = "History:";
  document.getElementById("history").appendChild(outputWrapper);

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

function createCollapsibleDiv(route) {
  const newDiv = document.createElement("div");
  newDiv.className = "output-wrapper";

  const buttonDiv = document.createElement("div");
  const command = document.createElement("button");
  command.textContent = route;
  const toggleButton = document.createElement("button");
  toggleButton.className = "toggle-button";
  toggleButton.textContent = "Collapse";
  buttonDiv.appendChild(command);
  buttonDiv.appendChild(document.createTextNode(" "));
  buttonDiv.appendChild(toggleButton);
  newDiv.appendChild(buttonDiv);

  const contentDiv = document.createElement("div");
  contentDiv.className = "output";
  contentDiv.style.display = "block";
  newDiv.appendChild(contentDiv);

  // Add click event to the toggle button
  toggleButton.addEventListener("click", function () {
    if (contentDiv.style.display === "none") {
      contentDiv.style.display = "block";
      toggleButton.textContent = "Collapse";
    } else {
      contentDiv.style.display = "none";
      toggleButton.textContent = "Expand";
    }
  });

  return [newDiv, contentDiv];
}

function collapseHistoryDivs() {
  const outputElements = document.getElementsByClassName("output");
  for (let element of outputElements) {
    element.style.display = "none";
  }

  const toggleButtonElements = document.getElementsByClassName("toggle-button");
  for (let element of toggleButtonElements) {
    element.textContent = "Expand";
  }
}

function adjustStateDivs(data) {
  if (data.deployState != "NONE") {
    checkSubnetStarted(data.containers.subnets);
    checkMiningState(data.mineInfo);
    checkServicesStarted(data.containers.services);
    checkSubswapFrontendStarted(data.containers.subswap);
    // checkExplorerStarted(data.containers.explorer);
    // INCOMPLETE means a generation started but never finished -- a failed
    // submit leaves only some of the files behind, and /state reports no
    // requirements for it. Keep the generator open in that case so the form can
    // be corrected and resubmitted; only a finished config locks step 1.
    if (data.requirements) {
      disableGenEmbed();
      showAddresses(data.requirements.addresses);
      showCopyInstruction(data.requirements.subnetConfig);
      showFaucet(data.requirements);
      unhideContractButtons(data.requirements.requireContracts);
      disableContractButtons(data.requirements.deployedContracts);
    }
  } else {
    // back to a clean slate (the subnet was removed): reopen the generator and
    // clear what the previous config had put on screen
    enableGenEmbed();
    resetParentnetInfo();
  }

  // allowClick()
  loadingFinished();
}

function loadingFinished() {
  // debug.html has no #body-wrap, and this is now called from an error path
  const wrap = document.getElementById("body-wrap");
  if (wrap) {
    wrap.style.pointerEvents = "auto";
  }
}

function loadingStart() {
  document.getElementById("body-wrap").style.pointerEvents = "none";
  document.getElementById("state").textContent = "Status: Loading...";
}

function disableGenEmbed() {
  const wrap = document.getElementById("gen-embed-wrap");
  if (!wrap || wrap.classList.contains("disabled")) {
    return;
  }
  wrap.classList.add("disabled");
  document.getElementById("gen-embed-note").textContent =
    "A subnet configuration already exists. Remove the subnet (/debug) before generating a new one.";
}

function enableGenEmbed() {
  const wrap = document.getElementById("gen-embed-wrap");
  if (!wrap || !wrap.classList.contains("disabled")) {
    return;
  }
  wrap.classList.remove("disabled");
  document.getElementById("gen-embed-note").textContent = "";
  // the frame was left on whatever page it last showed, usually the submit
  // result of the config that has just been removed
  document.getElementById("gen-embed").src = "/gen";
}

// same-origin iframe, so the frame can be sized to the form it holds instead of
// leaving the generator inside its own scrollbar
function setupGenEmbedAutoResize() {
  const iframe = document.getElementById("gen-embed");
  if (!iframe) {
    return;
  }
  const fit = () => {
    try {
      const doc = iframe.contentDocument;
      if (!doc || !doc.body) {
        return;
      }
      // measure the bottom of the content, not scrollHeight: the generator
      // views render without a doctype, so they are in quirks mode where both
      // body.scrollHeight and documentElement.scrollHeight are at least the
      // frame's own height -- feeding either back in grows the frame forever.
      const scrolled = doc.documentElement.scrollTop || doc.body.scrollTop || 0;
      let bottom = 0;
      for (const child of doc.body.children) {
        bottom = Math.max(bottom, child.getBoundingClientRect().bottom);
      }
      const height = Math.ceil(bottom + scrolled) + 16;
      if (bottom > 0 && Math.abs(height - iframe.clientHeight) > 2) {
        iframe.style.height = height + "px";
      }
    } catch (error) {
      // keep the CSS fallback height
      console.error("Error:", error);
    }
  };
  let observing = false;
  const attach = () => {
    fit();
    if (observing) {
      return;
    }
    // the form grows and shrinks as its optional sections are toggled, so
    // measuring once is not enough
    try {
      const body = iframe.contentDocument.body;
      const observer = new ResizeObserver(fit);
      // quirks mode leaves the body box stretched to the frame, so a section
      // collapsing may not resize it -- watch the children that do shrink
      observer.observe(body);
      for (const child of body.children) {
        observer.observe(child);
      }
      observing = true;
    } catch (error) {
      // body not parsed yet; the load event below retries
      console.error("Error:", error);
    }
  };
  iframe.addEventListener("load", () => {
    // submitting the form navigates the frame, so the observed body is gone
    observing = false;
    attach();
  });
  // the frame is often already loaded by the time body onload runs, in which
  // case the listener above never fires
  attach();
}

function disableButtons(className) {
  const elements = document.querySelectorAll(`.${className}`);
  elements.forEach((element) => {
    // element.style.display = 'block';
    element.disabled = true;
  });
}

function checkSubnetStarted(subnetsContainers) {
  if (subnetsContainers.length == 0) {
    document.getElementById("start-subnet-button").disabled = false;
    document.getElementById("stop-subnet-button").disabled = true;
  } else {
    document.getElementById("start-subnet-button").disabled = true;
    document.getElementById("stop-subnet-button").disabled = false;
  }
}

function checkMiningState(mineInfo) {
  if (!mineInfo) {
    document.getElementById(
      "mining-status"
    ).innerHTML = `Confirm mining status: Not Mining`;
    return;
  }
  if (mineInfo.blocks[0] > prevPrevBlockNum) {
    prevBlockNum = mineInfo.blocks[0];
    prevPrevBlockNum = prevBlockNum;
    document.getElementById(
      "mining-status"
    ).innerHTML = `Confirm mining status: Mining`;
  }
}

function checkServicesStarted(servicesContainers) {
  if (servicesContainers.length == 0) {
    document.getElementById("start-services-button").disabled = false;
    document.getElementById("stop-services-button").disabled = true;
  } else {
    document.getElementById("start-services-button").disabled = true;
    document.getElementById("stop-services-button").disabled = false;
    const ui = new URL(window.location.href);
    ui.port = "5214";
    const relayer = new URL(window.location.href);
    relayer.port = "5215";
    document.getElementById("services-details").innerHTML = `
<a href="${ui}" target="_blank">Subnet UI (please wait 2 minutes for loading after startup)</a>
<br>
<a href="${relayer}" target="_blank">Relayer UI</a>
<br><br>
`;
  }
}

function checkSubswapFrontendStarted(containers) {
  if (containers.length == 0) {
    document.getElementById("start-subswap-button").disabled = false;
    document.getElementById("stop-subswap-button").disabled = true;
  } else {
    document.getElementById("start-subswap-button").disabled = true;
    document.getElementById("stop-subswap-button").disabled = false;
    const subswap = new URL(window.location.href);
    subswap.port = "5216";
    document.getElementById("subswap-details").innerHTML = `
<a href="${subswap}" target="_blank">Subswap UI (please wait 2 minutes for loading after startup)</a>
<br>
`;
  }
}

function checkExplorerStarted(containers) {
  if (containers.length == 0) {
    document.getElementById("start-explorer-button").disabled = false;
    document.getElementById("stop-explorer-button").disabled = true;
  } else {
    document.getElementById("start-explorer-button").disabled = true;
    document.getElementById("stop-explorer-button").disabled = false;
    const explorer = new URL(window.location.href);
    explorer.port = "5217";
    document.getElementById("explorer-details").innerHTML = `
<a href="${explorer}" target="_blank">Explorer UI</a>
<br>
`;
  }
}

function enableButtonClass(className) {
  const elements = document.querySelectorAll(`.${className}`);
  elements.forEach((element) => {
    element.disabled = false;
  });
}

function unhideContractButtons(contracts) {
  const cscLiteButton = document.getElementById("button-csc-lite");
  const cscFullButton = document.getElementById("button-csc-full");
  const reverseCscButton = document.getElementById("button-reverse-csc");
  // const zeroButton = document.getElementById('button-zero') //retire this concept, only subswap or no subswap
  const subswapButton = document.getElementById("button-subswap");

  if (contracts.relayer == "lite") {
    cscLiteButton.disabled = false;
    cscLiteButton.style.display = "block";
  }
  if (contracts.relayer == "full") {
    cscFullButton.disabled = false;
    cscFullButton.style.display = "block";
  }
  if (contracts.zero == "bi-directional") {
    reverseCscButton.disabled = false;
    reverseCscButton.style.display = "block";
  }
  if (contracts.subswap == "true") {
    subswapButton.disabled = false;
    subswapButton.style.display = "block";
  }
}

function disableContractButtons(contracts) {
  const cscLiteButton = document.getElementById("button-csc-lite");
  const cscFullButton = document.getElementById("button-csc-full");
  const reverseCscButton = document.getElementById("button-reverse-csc");
  const subswapButton = document.getElementById("button-subswap");

  if (contracts.csc != "") {
    cscLiteButton.disabled = true;
    cscFullButton.disabled = true;
  }
  if (contracts.reverseCsc != "") {
    reverseCscButton.disabled = true;
  }
  if (contracts.parentnetApp != "" && contracts.subnetApp != "") {
    subswapButton.disabled = true;
  }
}

function showAddresses(addresses) {
  const parentnetWallet = document.getElementById("parentnet-wallet");
  const parentnetZeroWallet = document.getElementById("parentnet-zero-wallet");
  const subnetWallet = document.getElementById("subnet-wallet");
  const subnetZeroWallet = document.getElementById("subnet-zero-wallet");

  if (addresses.parentnetWallet !== "") {
    parentnetWallet.innerHTML =
      "&emsp;Relayer Parentnet Wallet: " + addresses.parentnetWallet;
  } else {
    parentnetWallet.innerHTML = "";
  }
  if (addresses.parentnetZeroWallet !== "") {
    parentnetZeroWallet.innerHTML =
      "&emsp;Relayer Parentnet Zero Wallet: " + addresses.parentnetZeroWallet;
  } else {
    parentnetZeroWallet.innerHTML = "";
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

function showCopyInstruction(config) {
  if (config.numMachine != "" && parseInt(config.numMachine) > 1) {
    const copyInstruction = document.getElementById("copy-instruction");
    copyInstruction.innerHTML = `
Copy files docker-compose.yml, genesis.json, config/subnetX.env to other machines<br>
Then start subnet nodes on other machines:<br>
docker compose --profile machineX pull;<br>
docker compose --profile machineX up -d;<br>
`;
  }
}

// Faucet links shown in step 3, keyed by parentnet. Each url becomes its own
// link. Mainnet has no faucet, so it is simply absent here and the line stays
// hidden. Edit these to change what step 3 links to -- a plain
// comma-separated string works too.
const PARENTNET_FAUCETS = {
  testnet: ["https://faucet.apothem.network/", "https://faucet.blocksscan.io/"],
  devnet: ["https://faucet.devnet.xinfin.org/"],
};

// accepts an array or a comma-separated string, so either editing style works
function faucetList(value) {
  if (!value) {
    return [];
  }
  const list = Array.isArray(value) ? value : String(value).split(",");
  return list.map((url) => url.trim()).filter(Boolean);
}

// showFaucet only ever revealed things, so whatever the last config showed stuck
// around -- after a /remove_subnet the old parentnet and its faucet stayed on
// screen. Reset the lines first so each state renders from scratch.
function resetParentnetInfo() {
  document.getElementById("parentnet-name-line").style.display = "none";
  document.getElementById("parentnet-url-line").style.display = "none";
  document.getElementById("parentnet-faucet-line").style.display = "none";
  // drop the links too so a hidden line never carries the previous faucets
  document.getElementById("parentnet-faucet-links").textContent = "";
}

function showFaucet(requirements) {
  resetParentnetInfo();
  const config = requirements.subnetConfig;
  const parentnet = config.parentnet;

  if (parentnet === "") {
    return;
  }

  document.getElementById("parentnet-name").textContent =
    parentnet.charAt(0).toUpperCase() + parentnet.slice(1);
  document.getElementById("parentnet-name-line").style.display = "block";

  // the RPC the relayer and the contract deploys actually talk to
  if (config.parentnetUrl) {
    document.getElementById("parentnet-url").textContent = config.parentnetUrl;
    document.getElementById("parentnet-url-line").style.display = "block";
  }

  const faucets = faucetList(PARENTNET_FAUCETS[parentnet]);
  if (faucets.length > 0) {
    const container = document.getElementById("parentnet-faucet-links");
    faucets.forEach((url, i) => {
      if (i > 0) {
        container.appendChild(document.createTextNode(", "));
      }
      const link = document.createElement("a");
      link.href = url;
      link.target = "_blank";
      link.textContent = url;
      container.appendChild(link);
    });
    document.getElementById("parentnet-faucet-line").style.display = "block";
  }
  // if (requirements.addresses.subnetWallet != "" || requirements.addresses.subnetZeroWallet != ""){
  //   const subnetFaucetInfo = document.getElementById("subnet-faucet-info")
  //   subnetFaucetInfo.style.display = "block"
  // }
}
// Address Generator helper (moved here with the Helpers section from /gen).
// /address builds the wallet locally in the manager process -- nothing leaves
// the machine, which is what the disclaimer next to the button refers to.
async function genAddress() {
  const pub = document.getElementById("address-gen-pub");
  const pk = document.getElementById("address-gen-pk");
  try {
    const response = await fetch("/address", { method: "GET" });
    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }
    const data = await response.json();
    pub.textContent = "Address: " + data.publicKey;
    pk.textContent = "Private Key: " + data.privateKey;
  } catch (error) {
    console.error("Error:", error);
    pub.textContent = "Error Generating Address";
    pk.textContent = "Error Generating Address";
  }
}

async function fetchLoop() {
  setupGenEmbedAutoResize();
  await callStateApi("/state", "state");
  setInterval(() => {
    callStateApi("/state", "state");
  }, 5000);
}
