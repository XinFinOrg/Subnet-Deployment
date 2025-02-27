async function callApi(route) {
  const outputDiv = document.getElementById('output');
  try {
    const response = await fetch(route, {method: 'GET'});
    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }

    const contentType = response.headers.get('Content-Type');
    let data;
    if (contentType && contentType.includes('application/json')) {
      console.log('response header JSON')
      data = await response.json();
      data = JSON.stringify(data, null, 2);
    } else {
      data = await response.text();
    }

    outputDiv.textContent = data
  } catch (error){
    console.error('Error:', error);
    outputDiv.textContent = 'API call failed: ' + error.message; 
  }
}

async function callStreamApi(route){
  const outputElement = document.getElementById('output'); 
  const eventSource = new EventSource(route);
  try {
    outputElement.textContent = ''
    eventSource.onmessage = (event) => {
      outputElement.textContent += event.data + '\n'; 
      outputElement.scrollTop = outputElement.scrollHeight; 
    };

    eventSource.addEventListener('close', (event) => {
      outputElement.textContent += event.data + '\n'; 
      eventSource.close(); 
    });

    eventSource.onerror = () => {
      console.log('EventSource failed.');
      outputElement.textContent += 'Error: Connection lost.\n';
      eventSource.close();
    }
  } catch (error){
    console.error('Error:', error);
    outputElement.textContent = 'API call failed: ' + error.message; 
  }
};