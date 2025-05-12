const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.CLIENT_PORT || 8080;

// Serve static files from the src directory
app.use(express.static(path.join(__dirname, 'src')));

// Route all requests to index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'src/pages/index.html'));
});

// Start the server
app.listen(PORT, () => {
  console.log(`Client server running at http://localhost:${PORT}`);
}); 