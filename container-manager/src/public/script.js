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
      // display = {
      //   containers: data.containers,
      //   mineInfo: data.mineInfo
      // }
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

function adjustStateDivs(data){
  // console.log('adjust divs')
  // console.log(data)
  if (data.deployState != 'NONE'){
    const genButton = document.getElementById("gen_button")
    genButton.disabled = true
  }
}

async function callStreamApi(route) {
  // const outputElement = document.createElement('div');
  // outputElement.className = 'output';
  collapseHistoryDivs();
  const [outputWrapper, outputElement] = createCollapsibleDiv(route);
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

async function fetchLoop(){
  await callStateApi('/state', 'state')
  setInterval(()=>{
    callStateApi('/state', 'state')
  }, 5000)
}