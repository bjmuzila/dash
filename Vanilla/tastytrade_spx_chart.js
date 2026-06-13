const fs = require('fs');

// Get valid session token
async function getSessionToken() {
  const tokenData = JSON.parse(fs.readFileSync('tastytrade_token.json', 'utf8'));
  
  if (tokenData.session_token) {
    return tokenData.session_token;
  }
  
  const response = await fetch('https://api.tastyworks.com/v1/sessions/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: tokenData.refresh_token })
  });
  
  if (!response.ok) throw new Error(`Token refresh failed: ${response.statusText}`);
  const data = await response.json();
  return data.session_token;
}

// Fetch tick data from TastyTrade
async function fetchSPXTicks(sessionToken) {
  const response = await fetch('https://api.tastyworks.com/v1/quote-streamer?symbols=SPX&type=tick', {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${sessionToken}`,
      'Content-Type': 'application/json'
    }
  });
  
  if (!response.ok) throw new Error(`TastyTrade error: ${response.statusText}`);
  return response.json();
}

// Aggregate ticks into 1-min OHLC candles
function aggregateToCandles(ticks) {
  const candles = {};
  
  ticks.forEach(tick => {
    const time = new Date(tick.timestamp);
    const minKey = time.toISOString().slice(0, 16); // YYYY-MM-DDTHH:MM
    
    if (!candles[minKey]) {
      candles[minKey] = {
        timestamp: minKey,
        open: tick.bid_price || tick.last_price,
        high: tick.bid_price || tick.last_price,
        low: tick.bid_price || tick.last_price,
        close: tick.bid_price || tick.last_price
      };
    } else {
      candles[minKey].high = Math.max(candles[minKey].high, tick.bid_price || tick.last_price);
      candles[minKey].low = Math.min(candles[minKey].low, tick.bid_price || tick.last_price);
      candles[minKey].close = tick.bid_price || tick.last_price;
    }
  });
  
  return Object.values(candles).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
}

// Send to Claude to create chart
async function createChartWithClaude(candles) {
  const chartPrompt = `Create an interactive chart showing SPX 1-minute OHLC data. 
Here's the data:
${JSON.stringify(candles, null, 2)}

Make a clean candlestick or line chart showing the price movement throughout the session. Use HTML/SVG or React.`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      messages: [
        { role: 'user', content: chartPrompt }
      ]
    })
  });

  const data = await response.json();
  console.log(data.content[0].text);
}

// Main flow
async function main() {
  try {
    console.log('Getting session token...');
    const sessionToken = await getSessionToken();
    
    console.log('Fetching SPX tick data...');
    const tickData = await fetchSPXTicks(sessionToken);
    
    console.log('Aggregating into 1-min candles...');
    const candles = aggregateToCandles(tickData.ticks || []);
    
    console.log(`Generated ${candles.length} candles. Sending to Claude...`);
    await createChartWithClaude(candles);
  } catch (err) {
    console.error('Error:', err.message);
  }
}

main();
