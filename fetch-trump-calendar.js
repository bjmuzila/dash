#!/usr/bin/env node
/**
 * Fetch Trump calendar from Roll Call and save to local JSON
 * Usage: node fetch-trump-calendar.js
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const SOURCE_URL = 'https://media-cdn.factba.se/rss/json/trump/calendar-full.json';
const OUTPUT_FILE = path.join(__dirname, 'data', 'trump_calendar_latest.json');
const DATA_DIR = path.join(__dirname, 'data');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  console.log(`✓ Created directory: ${DATA_DIR}`);
}

console.log('Fetching Trump calendar from factba.se...');
console.log(`URL: ${SOURCE_URL}`);

https.get(SOURCE_URL, {
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  }
}, (res) => {
  let data = '';

  res.on('data', (chunk) => {
    data += chunk;
  });

  res.on('end', () => {
    try {
      // Parse JSON directly from the API response
      let rawData = JSON.parse(data);

      // API returns an array directly, wrap it
      let calendarData;
      if (Array.isArray(rawData)) {
        calendarData = {
          events: rawData,
          count: rawData.length,
          fetched: new Date().toISOString(),
          source: SOURCE_URL
        };
      } else {
        // If it's already an object, use it
        calendarData = rawData;
        if (!calendarData.fetched) {
          calendarData.fetched = new Date().toISOString();
        }
        if (!calendarData.source) {
          calendarData.source = SOURCE_URL;
        }
        if (!calendarData.count && calendarData.events) {
          calendarData.count = calendarData.events.length;
        }
      }

      // Save to file
      fs.writeFileSync(OUTPUT_FILE, JSON.stringify(calendarData, null, 2));

      console.log(`✓ Calendar saved: ${OUTPUT_FILE}`);
      console.log(`✓ Events loaded: ${calendarData.count}`);
      console.log(`✓ Fetched: ${calendarData.fetched}`);
      process.exit(0);

    } catch (err) {
      console.error('✗ Error parsing calendar data:', err.message);
      process.exit(1);
    }
  });
}).on('error', (err) => {
  console.error('✗ Fetch error:', err.message);

  // Try alternative approach: use curl if available
  console.log('\n⚠ Trying alternative method with curl...');
  const { exec } = require('child_process');

  exec(`curl -s -H "User-Agent: Mozilla/5.0" "${ROLLCALL_URL}" | grep -o '"events":\\[.*\\]' > temp.json`, (err) => {
    if (!err && fs.existsSync('temp.json')) {
      try {
        const data = fs.readFileSync('temp.json', 'utf8');
        const json = JSON.parse(`{${data}}`);
        fs.writeFileSync(OUTPUT_FILE, JSON.stringify(json, null, 2));
        fs.unlinkSync('temp.json');
        console.log(`✓ Calendar fetched via curl and saved`);
        process.exit(0);
      } catch (e) {
        console.error('✗ Curl method failed:', e.message);
        process.exit(1);
      }
    } else {
      console.error('✗ Both methods failed. Please update the calendar manually.');
      process.exit(1);
    }
  });
});
