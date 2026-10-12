const express = require('express');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = 8080;

// Enable CORS for API calls to localhost:3000
app.use(cors());

// Serve static files from current directory
app.use(express.static(__dirname));

// Default route - redirect to login
app.get('/', (req, res) => {
  res.redirect('/login.html');
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('\n🎨 JuFlow Frontend Server');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`   Frontend URL: http://localhost:${PORT}`);
  console.log(`   Login Page:   http://localhost:${PORT}/login.html`);
  console.log(`   Dashboard:    http://localhost:${PORT}/dashboard-mongo.html`);
  console.log(`   Backend API:  http://localhost:3000`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('\n✅ Frontend server ready!\n');
});
