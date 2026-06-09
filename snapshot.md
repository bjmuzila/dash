# Snapshot, X, and Discord Button Logic

## Overview
Three-button sharing system for capturing and sharing screenshots/content to clipboard, Twitter/X, and Discord webhook.

---

## Rules

1. **Discord button requires a webhook** — must POST via `/proxy/api/webhooks/...`
2. **The COPY/X/DISCORD button pillbox has no background** — `background: transparent` on the wrapper
3. **Screenshots must have a dark background** — wrap content with `backgroundColor: '#05080d'`
4. **DOM panels use a dedicated capture zone div** — wrap only the data boxes (not the header, toolbar, or share buttons) in `id="[prefix]-capture-zone"`. Target that element instead of the full panel container. See [Capture Zone Pattern](#capture-zone-pattern).
5. **For canvas-based panels** (e.g. GEX chart): draw toolbar directly onto the canvas using Canvas 2D API (html2canvas cannot reliably capture overflow containers). Read live values from the DOM.
6. **For DOM-based panels** (e.g. heatmap, 0DTE stats): target the capture zone div with html2canvas — no `ignoreElements` needed since buttons are outside the zone.
7. **All toolbar buttons use the same feedback state cycle** — `…` (yellow/loading) → `✓` (green/success) or `ERR` (red/failure) → restore the original label and color after about `1.5s`

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
- `os` = 0DTE Option Statistics (insights.html)

---

## Capture Zone Pattern

For DOM-based panels, wrap **only the data boxes** in a dedicated capture zone div — placed after the header/toolbar row and before any raw dump or debug sections. The share buttons must live outside this div.

### HTML Structure
```html
<!-- Header / toolbar with share buttons — NOT inside capture zone -->
<div style="display:flex;align-items:center;justify-content:space-between">
  <div><!-- title --></div>
  <div style="display:flex;gap:8px">
    <!-- connect button, status dot, etc. -->
    <div style="display:flex;gap:2px;background:#070c14;border-radius:2px;padding:2px">
      <button id="[PREFIX]-copy-shot-btn" ...>COPY</button>
      <button id="[PREFIX]-share-x-btn" ...>X</button>
      <button id="[PREFIX]-share-discord-btn" ...>DISCORD</button>
    </div>
  </div>
</div>

<!-- ── CAPTURE ZONE: wrap all data cards here ── -->
<div id="[PREFIX]-capture-zone" style="display:flex;flex-direction:column;gap:12px;background:#05080d;padding:12px;border-radius:8px">
  <!-- Row 1 cards -->
  <!-- Row 2 cards -->
  <!-- Row N cards -->
</div>
<!-- ── END CAPTURE ZONE ── -->

<!-- Raw dump / debug — NOT inside capture zone -->
<div id="[PREFIX]-raw-dump">...</div>
```

### JS — targeting the capture zone
```javascript
function capturePanel(cb) {
  var target = document.getElementById('[PREFIX]-capture-zone');
  if (!target) { cb(new Error('no target'), null); return; }
  loadHtml2Canvas(function() {
    html2canvas(target, {
      backgroundColor: '#05080d',
      scale: 2,
      useCORS: true,
      logging: false,
      allowTaint: true
      // No ignoreElements needed — buttons are outside the capture zone
    }).then(function(canvas) {
      canvas.toBlob(function(blob) { cb(null, blob); }, 'image/png');
    }).catch(function(e) { cb(e, null); });
  });
}
```

**Panels using capture zone:**
| Panel | Capture Zone ID | File |
|-------|----------------|------|
| 0DTE Option Statistics | `os-capture-zone` | `insights.html` |

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
  
  if(btn){ btn.textContent='…'; btn.style.color='#ffb300'; }
  
  try{
    const wrapper = document.createElement('div');
    wrapper.style.backgroundColor = '#05080d';
    wrapper.style.display = 'inline-block';
    wrapper.style.padding = '10px';
    const canvasClone = canvas.cloneNode(true);
    wrapper.appendChild(canvasClone);
    document.body.appendChild(wrapper);
    
    const shot = await html2canvas(wrapper, {
      backgroundColor: '#05080d',
      scale: 2,
      useCORS: true,
      logging: false,
      allowTaint: true
    });
    
    document.body.removeChild(wrapper);
    
    shot.toBlob(async blob => {
      try{
        await navigator.clipboard.write([new ClipboardItem({'image/png': blob})]);
        if(btn){ btn.textContent='✓'; btn.style.color='#00e676'; 
          setTimeout(()=>{ btn.textContent='COPY SHOT'; btn.style.color='#00e5ff'; }, 1500);
        }
      } catch(e){
        if(btn){ btn.textContent='ERR'; btn.style.color='#ff4757'; 
          setTimeout(()=>{ btn.textContent='COPY SHOT'; btn.style.color='#00e5ff'; }, 1500);
        }
      }
    }, 'image/png');
  } catch(e){
    if(btn){ btn.textContent='ERR'; btn.style.color='#ff4757'; 
      setTimeout(()=>{ btn.textContent='COPY SHOT'; btn.style.color='#00e5ff'; }, 1500);
    }
  }
}
```

### For Capture Zone panels (0DTE Stats example)
```javascript
window.osCopyScreenshot = function() {
  var btn = document.getElementById('os-copy-shot-btn');
  var orig = btn ? btn.textContent : 'COPY';
  if (btn) { btn.textContent = '…'; btn.style.color = '#ffb300'; }
  capturePanel(function(err, blob) {
    if (err || !blob) {
      if (btn) { btn.textContent = 'ERR'; btn.style.color = '#ff4757'; }
      setTimeout(function() { if (btn) { btn.textContent = orig; btn.style.color = '#00e5ff'; } }, 1500);
      return;
    }
    navigator.clipboard.write([new ClipboardItem({'image/png': blob})]).then(function() {
      if (btn) { btn.textContent = '✓'; btn.style.color = '#00e676'; }
      setTimeout(function() { if (btn) { btn.textContent = orig; btn.style.color = '#00e5ff'; } }, 1500);
    }).catch(function() {
      if (btn) { btn.textContent = 'ERR'; btn.style.color = '#ff4757'; }
      setTimeout(function() { if (btn) { btn.textContent = orig; btn.style.color = '#00e5ff'; } }, 1500);
    });
  });
};
```

### For Text Content (Economic Calendar)
```javascript
async function copyCalendarScreenshot() {
  const btn = document.getElementById('cal-copy-shot-btn');
  if (btn) { btn.textContent = '…'; btn.style.color = '#ffb300'; }
  
  try {
    const template = formatCalendarTemplate();
    await navigator.clipboard.writeText(template);
    if (btn) {
      btn.textContent = '✓';
      btn.style.color = '#00e676';
      setTimeout(() => { btn.textContent = 'COPY'; btn.style.color = '#00e5ff'; }, 1500);
    }
  } catch (e) {
    // Error handling
  }
}
```

---

## GEX Chart Refresh + Timestamp Logic

The GEX chart uses the shared refresh stamp helper so the button and last-refresh label stay in sync.

### What the timestamp does
The timestamp label is updated at the same time:

- During refresh, it still shows the current refresh time
- On success, it stays on the latest completed refresh time
- On error, the text color switches red

### Shared implementation pattern
```javascript
function setInsightsRefreshStamp(date = new Date(), status = 'idle', tab = 'insights') {
  const prefix = getTabRefreshPrefix(tab);
  const stamp = document.getElementById(`${prefix}-refresh-time`);
  if (stamp) {
    stamp.textContent = `Last refresh: ${getETTimeLabel(date)}`;
    stamp.style.color = status === 'error' ? '#f87171' : status === 'success' ? 'var(--cyan)' : 'var(--text3)';
  }

  const btn = document.getElementById(`${prefix}-refresh-btn`);
  if (!btn) return;

  btn.disabled = status === 'loading';

  if (status === 'loading') {
    btn.textContent = 'Refreshing...';
    btn.style.background = 'rgba(0,229,255,.18)';
    btn.style.borderColor = 'rgba(0,229,255,.8)';
    btn.style.color = '#ffffff';
    return;
  }

  btn.textContent = status === 'success' ? 'Refreshed' : status === 'error' ? 'Retry Refresh' : 'Refresh';
  btn.style.background = status === 'success' ? 'rgba(0,200,136,.18)' : 'rgba(0,229,255,.08)';
  btn.style.borderColor = status === 'success' ? 'rgba(0,200,136,.65)' : 'rgba(0,229,255,.45)';
  btn.style.color = status === 'success' ? '#d1fae5' : 'var(--cyan)';

  if (status === 'success' || status === 'error') {
    clearTimeout(window.__insightsRefreshStatusTimer[prefix]);
    window.__insightsRefreshStatusTimer[prefix] = setTimeout(() => setInsightsRefreshStamp(date, 'idle', prefix), 1800);
  }
}
```

### Refresh flow
```javascript
async function runSharedInsightsRefresh(tab = 'insights') {
  const startedAt = new Date();
  const prefix = getTabRefreshPrefix(tab);
  setInsightsRefreshStamp(startedAt, 'loading', prefix);

  try {
    let refreshed = true;
    if (typeof window.fetchGEX === 'function') {
      refreshed = await window.fetchGEX();
    }
    if (refreshed === false) throw new Error('Refresh request did not complete');

    const completedAt = new Date();
    window.__insightsLastDataRefresh = completedAt.toISOString();
    setInsightsRefreshStamp(completedAt, 'success', prefix);
    return true;
  } catch (e) {
    setInsightsRefreshStamp(new Date(), 'error', prefix);
    throw e;
  }
}
```

---

## Refresh Button Visual Feedback System (↻ Now)

### Overview
The "↻ Now" manual refresh button provides comprehensive visual feedback through 5 distinct states, giving users immediate confirmation of their action and clarity about the refresh status.

### Visual State Sequence

```
STATE 1: IDLE (t=0ms)
┌──────────────────┐
│   ↻ Now          │ ← Cyan, clickable
└──────────────────┘
User sees normal button


STATE 2: REFRESHING (t=0-2s)
┌──────────────────┐
│ ↻ Refreshing...  │ ← Grayed (0.6 opacity), disabled
└──────────────────┘
Immediate feedback - click registered


STATE 3: SUCCESS (t=~1.5s)
╔══════════════════╗
║  ✓ Refreshed    ║ ← Green glow, bright
║   GREEN GLOW    ║
╚══════════════════╝
Data loaded successfully


STATE 4: HOLD FEEDBACK (t=1.5-3.3s)
╔══════════════════╗
║  ✓ Refreshed    ║ ← Displayed for 1.8 seconds
║   GREEN GLOW    ║
╚══════════════════╝
User has time to see result


STATE 5: RETURN TO NORMAL (t=3.3s+)
┌──────────────────┐
│   ↻ Now          │ ← Back to cyan, clickable
└──────────────────┘
Ready for next refresh
```

### Complete Timeline

```
0ms      User clicks "↻ Now"
         │
         ▼
         [Button: ↻ Refreshing...]
         [Status: Disabled, grayed]
         │
         ├─ Opacity: 0.6
         ├─ Cursor: not-allowed
         └─ fetchGEX() starts
         │
100ms    │ API request in flight
         │ WebSocket listening for Greeks
         │
1000ms   │ Data arriving from server
         │
1500ms   │ fetchGEX() completes
         ▼
         [Button: ✓ Refreshed]
         [Status: Green glow (0 0 12px)]
         [Background: rgba(0,230,118,0.1)]
         │
         ├─ Color: var(--green) #00e676
         ├─ TextShadow: 0 0 12px rgba(0,230,118,0.5)
         ├─ Border: var(--green)
         └─ Display for 1.8 seconds
         │
1800ms   │ Timer elapsed
         │ All styles clear
         ▼
         [Button: ↻ Now]
         [Status: Normal, clickable]
         │
         ├─ Countdown timer resets
         └─ Ready for next refresh
```

### Error Path

If API fails during refresh:

```
[↻ Refreshing...]  (0-2s, disabled)
        │
        ├─ fetchGEX() throws error
        │
        ▼
[✗ Failed]  (red glow, 1.8s)
        │
        ├─ Color: var(--red) #ff4757
        ├─ TextShadow: 0 0 12px rgba(255,71,87,0.5)
        ├─ Background: rgba(255,71,87,0.1)
        │
        ▼
[↻ Now]  (normal, clickable)
        │
        └─ Can retry refresh
```

### State Details

| State | Text | Color | Background | Opacity | Cursor | Disabled | Duration |
|-------|------|-------|------------|---------|--------|----------|----------|
| **Idle** | ↻ Now | Cyan | Transparent | 1.0 | pointer | No | Until click |
| **Refreshing** | ↻ Refreshing... | Gray | Darkened | 0.6 | not-allowed | Yes | 0.5-2s |
| **Success** | ✓ Refreshed | Green #00e676 | rgba(0,230,118,0.1) | 1.0 | default | Yes | 1.8s |
| **Error** | ✗ Failed | Red #ff4757 | rgba(255,71,87,0.1) | 1.0 | default | Yes | 1.8s |
| **Return** | ↻ Now | Cyan | Transparent | 1.0 | pointer | No | Until click |

### Implementation Details

#### Function: `manualRefresh()`
**Location:** `shared/overview.js` (line 3863)

```javascript
async function manualRefresh(){
  const btn = document.querySelector('button[onclick="manualRefresh()"]');
  
  // Prevent double-clicks
  if (btn.disabled) return;
  
  // Step 1: Show refreshing state
  btn.textContent = '↻ Refreshing...';
  btn.disabled = true;
  btn.style.opacity = '0.6';
  
  // Step 2: Execute refresh
  try {
    await fetchGEX();
    refreshSuccess = true;
  } catch (error) {
    refreshSuccess = false;
  }
  
  // Step 3: Show success or error
  if (refreshSuccess) {
    btn.textContent = '✓ Refreshed';
    btn.style.color = 'var(--green)';
    btn.style.textShadow = '0 0 12px rgba(0,230,118,0.5)';
  } else {
    btn.textContent = '✗ Failed';
    btn.style.color = 'var(--red)';
    btn.style.textShadow = '0 0 12px rgba(255,71,87,0.5)';
  }
  
  // Step 4: Hold feedback for 1.8 seconds
  await new Promise(r => setTimeout(r, 1800));
  
  // Step 5: Return to normal
  btn.textContent = originalText;
  btn.disabled = false;
  btn.style.color = '';
  btn.style.opacity = '';
  resetCountdown();
}
```

#### Key Features

✅ **Duplicate Refresh Prevention**
```javascript
if (btn.disabled) return;  // Block if already refreshing
```

✅ **Error Handling**
```javascript
try {
  await fetchGEX();
  refreshSuccess = true;
} catch (error) {
  refreshSuccess = false;  // Show error state
}
```

✅ **Safe State Reset**
```javascript
finally {
  // Always clears styles, even if error occurs
}
```

✅ **Async/Await Pattern**
```javascript
async function manualRefresh(){
  await fetchGEX();
  await new Promise(r => setTimeout(r, 1800));
}
```

### CSS Styling

#### Button Base (`shared/styles.css`)
```css
.btn {
  transition: all 0.15s;  /* Smooth transitions */
  cursor: pointer;
}

.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
```

#### Inline Styles Applied by JavaScript

**During Refreshing:**
```javascript
btn.style.opacity = '0.6';
btn.style.cursor = 'not-allowed';
```

**During Success:**
```javascript
btn.style.color = 'var(--green)';
btn.style.textShadow = '0 0 12px rgba(0,230,118,0.5)';
btn.style.borderColor = 'var(--green)';
btn.style.background = 'rgba(0,230,118,0.1)';
```

**During Error:**
```javascript
btn.style.color = 'var(--red)';
btn.style.textShadow = '0 0 12px rgba(255,71,87,0.5)';
btn.style.borderColor = 'var(--red)';
btn.style.background = 'rgba(255,71,87,0.1)';
```

### HTML Structure

**Location:** `index.html` (line 450)

```html
<button class="btn btn-ghost btn-sm" onclick="manualRefresh()">↻ Now</button>
```

**Classes:**
- `btn` - Base button styles with transitions
- `btn-ghost` - Transparent background
- `btn-sm` - Small padding

### Timing Specifications

| Phase | Duration | Notes |
|-------|----------|-------|
| Click to "Refreshing..." | 0-10ms | Instant user feedback |
| "Refreshing..." to result | 500-2000ms | API fetch time |
| Success/Error display | 1800ms | 1.8 seconds |
| Total cycle | ~2.3-3.8s | From click to ready |
| Countdown reset | Immediate | Timer resets to 30s |

### Color Palette

| State | Color | Hex | RGB |
|-------|-------|-----|-----|
| Idle | Cyan | #a8b8cc | 168, 184, 204 |
| Refreshing | Gray | #888888 | 136, 136, 136 |
| Success | Green | #00e676 | 0, 230, 118 |
| Error | Red | #ff4757 | 255, 71, 87 |

### User Experience Benefits

✅ **Immediate Feedback** - User knows click registered (no mystery waiting)
✅ **Clear Status** - "Refreshing..." tells what's happening
✅ **Success Confirmation** - Green glow celebrates successful update
✅ **Error Visibility** - Red glow alerts to problems
✅ **Prevents Mistakes** - Button disabled, can't double-click
✅ **Self-Healing** - Auto-returns to normal, no manual reset
✅ **Non-Intrusive** - Uses subtle styling, doesn't block UI
✅ **Professional** - Polish and attention to detail

### Files Modified

1. **`shared/overview.js`** (lines 3863-3920)
   - Enhanced `manualRefresh()` function with comprehensive async state management
   - Added error handling
   - Added visual state management
   - Added duplicate prevention

2. **`shared/styles.css`** (lines 37-42)
   - Added `transition: all 0.15s` to `.btn`
   - Added `.btn:disabled` rule with opacity and cursor styles

**No other files modified** - Changes are isolated and safe.

---

## X Button Logic

### Purpose
Open Twitter/X in a new window for manual posting (user pastes screenshot from clipboard).

### Implementation
```javascript
if (platform === 'x') {
  setTimeout(() => {
    if (btn) { btn.textContent = orig; btn.style.color = '#00e5ff'; }
    window.open('https://twitter.com/intent/tweet?text=SPX+Options+GEX', '_blank');
  }, 300);
  return;
}
```

**Note:** X button does not directly post — it opens Twitter and the user manually pastes.

---

## DISCORD Button Logic

### Purpose
Capture screenshot and POST directly to Discord webhook as file attachment.

### Step 1: Webhook URL
```javascript
const DISCORD_WEBHOOK_URL = '/proxy/api/webhooks/1466249857122570454/REDACTED';
```

**Direct Discord URL (reference only):**
```
https://discord.com/api/webhooks/1466249857122570454/REDACTED
```

> **Important:** Always use `/proxy/api/webhooks/...` — direct Discord URL is CORS-blocked.

### Step 2: Discord POST
```javascript
var form = new FormData();
form.append('payload_json', JSON.stringify({ content: 'Panel title here' }));
form.append('files[0]', blob, 'screenshot.png');

fetch(DISCORD_WEBHOOK_URL, { method: 'POST', body: form })
  .then(function(res) {
    if (!res.ok) throw new Error('webhook ' + res.status);
    // success state
  })
  .catch(function() {
    // error state
  });
```

### Step 3: Full Share Function (capture zone pattern)
```javascript
window.osShare = function(platform) {
  var btn = platform === 'x'
    ? document.getElementById('os-share-x-btn')
    : document.getElementById('os-share-discord-btn');
  var origColor = platform === 'x' ? '#00e5ff' : '#7289da';
  var orig = btn ? btn.textContent : platform.toUpperCase();
  if (btn) { btn.textContent = '…'; btn.style.color = '#ffb300'; }

  if (platform === 'x') {
    setTimeout(function() {
      if (btn) { btn.textContent = orig; btn.style.color = origColor; }
      window.open('https://twitter.com/intent/tweet?text=SPX+0DTE+Option+Statistics', '_blank');
    }, 300);
    return;
  }

  capturePanel(function(err, blob) {
    if (err || !blob) {
      if (btn) { btn.textContent = 'ERR'; btn.style.color = '#ff4757'; }
      setTimeout(function() { if (btn) { btn.textContent = orig; btn.style.color = origColor; } }, 1500);
      return;
    }
    var form = new FormData();
    form.append('payload_json', JSON.stringify({ content: 'SPX 0DTE Option Statistics' }));
    form.append('files[0]', blob, 'spx-optstat.png');
    fetch(DISCORD_WEBHOOK_URL, { method: 'POST', body: form }).then(function(res) {
      if (res.ok) {
        if (btn) { btn.textContent = '✓'; btn.style.color = '#00e676'; }
        setTimeout(function() { if (btn) { btn.textContent = orig; btn.style.color = origColor; } }, 1500);
      } else { throw new Error('webhook ' + res.status); }
    }).catch(function() {
      if (btn) { btn.textContent = 'ERR'; btn.style.color = '#ff4757'; }
      setTimeout(function() { if (btn) { btn.textContent = orig; btn.style.color = origColor; } }, 1500);
    });
  });
};
```

---

## Proxy Configuration

### Required Proxy Route
```javascript
// POST /proxy/api/webhooks/:id/:token
const webhookMatch = p.match(/^\/proxy\/api\/webhooks\/(.+)\/(.+)$/);
if (req.method === 'POST' && webhookMatch) {
  const discordUrl = `https://discord.com/api/webhooks/${webhookMatch[1]}/${webhookMatch[2]}`;
  
  let bodyChunks = [];
  req.on('data', chunk => bodyChunks.push(chunk));
  req.on('end', () => {
    const body = Buffer.concat(bodyChunks);
    const contentType = req.headers['content-type'];
    
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
- **Cyan (#00e5ff)** — COPY and X buttons
- **Discord (#7289da)** — DISCORD button
- **Yellow (#ffb300)** — Loading state
- **Green (#00e676)** — Success state
- **Red (#ff4757)** — Error state

### Screenshot Background
- Capture zone div has `background: #05080d` inline
- Pass `backgroundColor: '#05080d'` to html2canvas as well
- Use `scale: 2` for high-quality output

### Discord Requirements
- Use **FormData** with `files[0]` for image attachment
- Include `payload_json` field with `{ content: "text" }`
- POST to `/proxy/api/webhooks/...` (NOT direct Discord URL)

### html2canvas — Dynamic Load
```javascript
function loadHtml2Canvas(cb) {
  if (typeof html2canvas !== 'undefined') { cb(); return; }
  var s = document.createElement('script');
  s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
  s.onload = cb;
  document.head.appendChild(s);
}
```

---

## Template Examples

### GEX Chart
- **COPY**: Screenshot canvas to clipboard
- **X**: Open Twitter
- **DISCORD**: POST canvas screenshot to webhook

### Heatmap
- **COPY**: Screenshot to clipboard
- **X**: Open Twitter
- **DISCORD**: POST screenshot to webhook

### Economic Calendar
- **COPY**: Formatted text template to clipboard
- **X**: Open Twitter
- **DISCORD**: POST text template to webhook (no image)

### 0DTE Option Statistics (`os` prefix)
- **COPY**: Screenshot of `#os-capture-zone` (data cards only) to clipboard
- **X**: Open Twitter
- **DISCORD**: POST `#os-capture-zone` screenshot to webhook
- Capture zone excludes: header bar, connect button, share buttons, raw dump section

---

## Economic Calendar Snapshot Only

This section applies only to the **Economic Calendar snapshot**.

### Files
- **Preview template file:** `snapshot-template-example.html`
- **Live snapshot logic:** `pages/overview.js`
- **Logo asset used by the live snapshot:** `assets/bzla-logo-transparent.png`

### Current behavior
- The economic calendar snapshot is rendered as an **image card**, not copied as plain text.
- The live capture entry point is `_buildTodaySnapshotEl()` in `pages/overview.js`.
- The quote is normalized into this format before rendering:
  - `"quote" - Author`
- The logo is placed in the bottom-right corner of the economic calendar snapshot only.

### Featured event logic
- The highlighted event is **not** simply the first event of the day.
- The highlighted event is the **highest-ranked event** from today's economic calendar items.
- If two events land in the same rank bucket, the **earlier time wins**.

### Economic calendar priority order
The current ranking logic for the **economic calendar snapshot only** is:

1. `US Nonfarm Payrolls (NFP)` / `employment report`
2. `US Unemployment Rate`
3. `US Hourly Earnings` / `Average Hourly Earnings`
4. `US CPI` / `Core CPI` / `Consumer Price Index`
5. `FOMC` / `Fed Rate Decision` / `Dot Plot` / `Powell Press Conference`
6. `US GDP`
7. `US PPI` / `Producer Price Index`
8. `ISM Manufacturing PMI`
9. `ISM Services PMI`
10. `US Retail Sales`
11. `US ADP Private Payrolls`
12. `Weekly Initial Jobless Claims`
13. `US PCE Price Index` / `Core PCE`
14. `US Durable Goods Orders`
15. `US Industrial Production`
16. `US Housing Starts / Building Permits`
17. `US Existing Home Sales`
18. `US JOLTS Job Openings`
19. `US Consumer Confidence / Michigan Sentiment`
20. `US Factory Orders`
21. `US Trade Balance`
22. `Central Bank Decisions (ECB, BoE, etc.) + major global CPI/GDP/PMIs`

### Important note
- This ranking logic is currently intended for the **economic calendar snapshot only**.
- It should not be assumed to apply to GEX, heatmap, 0DTE stats, or other snapshot types.

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "Failed to fetch" to Discord | Check proxy webhook route exists |
| Transparent background | Ensure capture zone div has `background:#05080d` and pass same to html2canvas |
| Share buttons appearing in screenshot | Move buttons outside the capture zone div |
| CORS error | Use `/proxy/api/` endpoint, not direct Discord URL |
| 400 Bad Request from Discord | Ensure FormData format with `payload_json` + `files[0]` |
| Image appears as file | Check Discord webhook accepts FormData (should render inline) |
| Button not responding | Check onclick handler name matches function name |
| Capture zone not found | Verify `id="[PREFIX]-capture-zone"` exists in DOM when tab is visible |
