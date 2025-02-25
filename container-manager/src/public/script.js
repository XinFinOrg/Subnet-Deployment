function callApi(route) {
  fetch(route, {
      method: 'GET', // or 'POST' depending on your API requirements
      headers: {
          'Content-Type': 'application/json'
      }
  })
  .then(response => response.json())
  .then(data => {
      // Display the formatted JSON response in the output div
      const outputDiv = document.getElementById('output');
      outputDiv.textContent = JSON.stringify(data, null, 2); // Pretty-print JSON
  })
  .catch((error) => {
      console.error('Error:', error);
      const outputDiv = document.getElementById('output');
      outputDiv.textContent = 'API call failed: ' + error.message;
  });
}