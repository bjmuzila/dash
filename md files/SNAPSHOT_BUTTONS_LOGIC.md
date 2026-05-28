# Snapshot, X, and Discord Button Logic

## Overview
Three-button sharing system for capturing and sharing screenshots/content to clipboard, Twitter/X, and Discord webhook.

---

## Architecture

### 1. Buttons HTML
```html
<div style="display:flex;gap:2px;background:#070c14;border-radius:2px;padding:2px">
  <button id="[PREFIX]-copy-shot-btn" onclick="copy[Name]Screenshot()" title="Copy screenshot" 
    style="font-size:9px;padding:2px 8px;border:none;border-radius:2px;background:transparent;color:#00e5ff;cursor:pointer;font-family:Arial;font-weight:700">COPY</button>
  <button id="[PREFIX]-share-x-btn" onclick="share[Name]('x')" title="Copy and open X" 
    style="font-size:9px;padding:2px 8px;border:none;border-radius:2px;background:transparent;color:#00e5ff;cursor:pointer;font-family:Arial;font-weight:700">X</button>
  <button id="[PREFIX]-share-discord-btn" onclick="share[Name]('discord')" title="Post to Discord" 
    style="font-size:9px;padding:2px 8px;border:none;border-radius:2px;background:transparent;color:#7289da;cursor:pointer;font-family:Arial;font-weight:700">DISCORD</button>
</div>
```

**Prefixes used:**
- `gex` = GEX Chart
- `hm` = Heatmap
- `cal` = Calendar

---

## Core Functions

### Button State Management
```javascript
// Loading state
btn.textContent = '…';
btn.style.color = '#ffb300';

// Success state
btn.textContent = '✓';
btn.style.color = '#00e676';
setTimeout(() => {
  btn.textContent = originalText;
  btn.style.color = originalColor;
}, 1500);

// Error state
btn.textContent = 'ERR';
btn.style.color = '#ff4757';
setTimeout(() => {
  btn.textContent = originalText;
  btn.style.color = originalColor;
}, 1500);
```

---

## COPY Button Logic

### Purpose
Copy screenshot or template to system clipboard.

### Implementation (GEX Chart example)
```javascript
async function copyActiveGexChartScreenshot(){
  const btn = document.getElementById('gex-copy-shot-btn');
  const canvas = document.getElementById('overview-canvas');
  if(!canvas || typeof html2canvas==='undefined') return;
  
  // Set loading state
  if(btn){ btn.textContent='…'; btn.style.color='#ffb300'; }
  
  try{
    // Create wrapper with background
    const wrapper = document.createElement('div');
    wrapper.style.backgroundColor = '#05080d';
    wrapper.style.display = 'inline-block';
    wrapper.style.padding = '10px';
    const canvasClone = canvas.cloneNode(true);
    wrapper.appendChild(canvasClone);
    
    // Temporarily add to DOM for html2canvas
    document.body.appendChild(wrapper);
    
    // Capture with html2canvas
    const shot = await html2canvas(wrapper, {
      backgroundColor: '#05080d',
      scale: 2,
      useCORS: true,
      logging: false,
      allowTaint: true
    });
    
    // Remove temporary wrapper
    document.body.removeChild(wrapper);
    
    // Convert to blob and copy to clipboard
    shot.toBlob(async blob => {
      try{
        await navigator.clipboard.write([new ClipboardItem({'image/png': blob})]);
        // Success state
        if(btn){ btn.textContent='✓'; btn.style.color='#00e676'; 
          setTimeout(()=>{ btn.textContent='COPY SHOT'; btn.style.color='#00e5ff'; }, 1500);
        }
      } catch(e){
        // Error state
        if(btn){ btn.textContent='ERR'; btn.style.color='#ff4757'; 
          setTimeout(()=>{ btn.textContent='COPY SHOT'; btn.style.color='#00e5ff'; }, 1500);
        }
      }
    }, 'image/png');
  } catch(e){
    // Error state
    if(btn){ btn.textContent='ERR'; btn.style.color='#ff4757'; 
      setTimeout(()=>{ btn.textContent='COPY SHOT'; btn.style.color='#00e5ff'; }, 1500);
    }
  }
}
```

### For Text Content (Economic Calendar)
```javascript
async function copyCalendarScreenshot() {
  const btn = document.getElementById('cal-copy-shot-btn');
  if (btn) { btn.textContent = '…'; btn.style.color = '#ffb300'; }
  
  try {
    const template = formatCalendarTemplate(); // Get formatted text
    await navigator.clipboard.writeText(template);
    
    if (btn) {
      btn.textContent = '✓';
      btn.style.color = '#00e676';
      setTimeout(() => {
        btn.textContent = 'COPY';
        btn.style.color = '#00e5ff';
      }, 1500);
    }
  } catch (e) {
    // Error handling
  }
}
```

---

## X Button Logic

### Purpose
Copy screenshot to clipboard, then open Twitter/X in new window for manual posting.

### Implementation
```javascript
async function shareActiveGexChart(platform){
  if (platform === 'x') {
    // Just open X - user will paste from clipboard
    window.open('https://twitter.com/intent/tweet?text=SPX+Options+GEX', '_blank');
    return;
  }
  // Discord logic follows...
}
```

**Note:** X button doesn't directly post - it opens Twitter and user manually pastes the screenshot from clipboard.

---

## DISCORD Button Logic

### Purpose
Capture screenshot and POST directly to Discord webhook as file attachment.

### Step 1: Setup Webhook URL
```javascript
const DISCORD_WEBHOOK_URL = '/proxy/api/webhooks/[WEBHOOK_ID]/[WEBHOOK_TOKEN]';
```

**Important:** Use `/proxy/api/webhooks/...` (local proxy) NOT `https://discord.com/api/webhooks/...` (CORS blocked)

### Step 2: Capture Function
```javascript
async function captureBlob(target) {
  if (!target) throw new Error('No capture target');
  const canvas = await renderElement(target);
  return canvasToBlob(canvas);
}

async function renderElement(element) {
  await loadHtml2Canvas();
  return html2canvas(element, {
    backgroundColor: '#05080d',
    scale: 2,
    useCORS: true,
    logging: false
  });
}

function canvasToBlob(canvas) {
  return new Promise(resolve => {
    canvas.toBlob(blob => resolve(blob), 'image/png');
  });
}
```

### Step 3: Discord Webhook POST
```javascript
async function postDiscordWebhook(target, text) {
  const blob = await captureBlob(target);
  
  // Create FormData with payload_json + file
  const form = new FormData();
  form.append('payload_json', JSON.stringify({ content: text }));
  form.append('files[0]', blob, `screenshot.png`);
  
  // POST to Discord webhook via proxy
  const res = await fetch(DISCORD_WEBHOOK_URL, { 
    method: 'POST', 
    body: form 
  });
  
  if (!res.ok) throw new Error(`Discord webhook failed: ${res.status}`);
}
```

### Step 4: Full Share Function
```javascript
async function shareActiveGexChart(platform) {
  const btn = platform === 'x' ? 
    document.getElementById('gex-share-x-btn') : 
    document.getElementById('gex-share-discord-btn');
  
  const orig = btn ? btn.textContent : '';
  if (btn) { btn.textContent = '…'; btn.style.color = '#ffb300'; }
  
  if (platform === 'x') {
    setTimeout(() => {
      if (btn) {
        btn.textContent = orig;
        btn.style.color = '#00e5ff';
      }
      window.open('https://twitter.com/intent/tweet?text=SPX+Options+GEX', '_blank');
    }, 300);
    return;
  }
  
  // Discord
  try {
    await postDiscordWebhook(target, 'SPX Options GEX');
    
    if (btn) {
      btn.textContent = '✓';
      btn.style.color = '#00e676';
      setTimeout(() => {
        btn.textContent = orig;
        btn.style.color = '#7289da';
      }, 1500);
    }
  } catch (e) {
    console.error('Discord share failed:', e);
    if (btn) {
      btn.textContent = 'ERR';
      btn.style.color = '#ff4757';
      setTimeout(() => {
        btn.textContent = orig;
        btn.style.color = '#7289da';
      }, 1500);
    }
  }
}
```

---

## Proxy Configuration

### Required Proxy Route
The backend proxy MUST have this endpoint:

```javascript
// POST /proxy/api/webhooks/:id/:token
// Forward Discord webhook requests
const webhookMatch = p.match(/^\/proxy\/api\/webhooks\/(.+)\/(.+)$/);
if (req.method === 'POST' && webhookMatch) {
  const discordUrl = `https://discord.com/api/webhooks/${webhookMatch[1]}/${webhookMatch[2]}`;
  
  // Collect request body
  let bodyChunks = [];
  req.on('data', chunk => bodyChunks.push(chunk));
  
  req.on('end', () => {
    const body = Buffer.concat(bodyChunks);
    const contentType = req.headers['content-type'];
    
    // Forward to Discord
    const discordReq = https.request(new URL(discordUrl), {
      method: 'POST',
      headers: {
        'Content-Type': contentType,
        'Content-Length': body.length
      }
    }, discordRes => {
      res.writeHead(discordRes.statusCode, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      });
      discordRes.pipe(res);
    });
    
    discordReq.write(body);
    discordReq.end();
  });
  
  return;
}
```

---

## Key Points

### Colors
- **Cyan (#00e5ff)** - X and primary buttons
- **Discord (#7289da)** - Discord button
- **Yellow (#ffb300)** - Loading state
- **Green (#00e676)** - Success state
- **Red (#ff4757)** - Error state

### Screenshot Background
- Wrap content in div with `backgroundColor: '#05080d'` before capturing
- Temporarily add to DOM if needed
- Use `scale: 2` for high-quality output

### Discord Requirements
- Use **FormData** with `files[0]` for image attachment
- Include `payload_json` field with `{content: "text"}`
- POST to `/proxy/api/webhooks/...` (NOT direct Discord URL)
- Proxy must forward to `https://discord.com/api/webhooks/...`

### html2canvas Library
```javascript
// Load dynamically
if (typeof html2canvas === 'undefined') {
  const script = document.createElement('script');
  script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
  document.head.appendChild(script);
  // Wait for load...
}
```

---

## Template Examples

### GEX Chart
- **COPY**: Screenshot to clipboard
- **X**: Open Twitter (user pastes from clipboard)
- **DISCORD**: POST screenshot to webhook

### Heatmap
- **COPY**: Screenshot to clipboard  
- **X**: Open Twitter (user pastes from clipboard)
- **DISCORD**: POST screenshot to webhook

### Economic Calendar
- **COPY**: Text template to clipboard (formatted date + quote + events)
- **X**: Open Twitter (user pastes from clipboard)
- **DISCORD**: POST text template to webhook (no image)

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "Failed to fetch" to Discord | Check proxy webhook route exists |
| Transparent background | Wrap content in div with explicit backgroundColor |
| CORS error | Use `/proxy/api/` endpoint, not direct Discord URL |
| 400 Bad Request from Discord | Ensure FormData format with `payload_json` + `files[0]` |
| Image appears as file | Check Discord webhook accepts FormData (should render inline) |
| Button not responding | Check onclick handler name matches function name |

