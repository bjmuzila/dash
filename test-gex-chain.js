const http = require('http');

const options = {
  hostname: 'localhost',
  port: 3001,
  path: '/proxy/api/tt/gex-chain',
  method: 'GET'
};

const req = http.request(options, (res) => {
  let data = '';
  res.on('data', (chunk) => {
    data += chunk;
  });
  res.on('end', () => {
    console.log('Status:', res.statusCode);
    console.log('Response:', data.slice(0, 1000));
    try {
      const json = JSON.parse(data);
      console.log('Parsed rows count:', json.rows ? json.rows.length : 0);
      if (json.rows && json.rows.length > 0) {
        console.log('First row:', json.rows[0]);
      }
    } catch (e) {
      console.log('Parse error:', e.message);
    }
  });
});

req.on('error', (e) => {
  console.error('Request error:', e.message);
});

req.end();
