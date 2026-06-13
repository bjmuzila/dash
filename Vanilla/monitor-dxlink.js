const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:8080/ws/dxlink');

ws.on('open', () => {
  console.log('[Connected to dxLink WebSocket]');
  ws.send(JSON.stringify({ type: 'subscribe', symbols: ['AAPL', 'SPX', 'VIX'] }));
});

ws.on('message', (data) => {
  try {
    const msg = JSON.parse(data);
    if (msg.type === 'FEED_DATA' && Array.isArray(msg.data)) {
      const eventType = msg.data[0];
      const rows = msg.data[1];
      
      if (eventType === 'Summary') {
        console.log(`\n[SUMMARY EVENT]`, rows.slice(0, 10));
      }
      if (eventType === 'Quote') {
        const sym = rows[1];
        if (['AAPL', 'SPX', 'VIX'].includes(sym)) {
          console.log(`[Quote] ${sym}:`, rows.slice(0, 5));
        }
      }
    }
  } catch(e) {}
});

ws.on('error', (e) => console.error('WS Error:', e.message));
ws.on('close', () => console.log('WebSocket closed'));

setTimeout(() => ws.close(), 30000); // Close after 30 seconds
