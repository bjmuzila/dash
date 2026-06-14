// ═══════════════════════════════════════════════════════════════════════════
// ECONOMIC CALENDAR JSON IMPORTER
// Drag-drop JSON or screenshot → auto-populate ECON_EVENTS
// ═══════════════════════════════════════════════════════════════════════════

// Create drop zone UI
function initCalendarImporter() {
  const dropZone = document.createElement('div');
  dropZone.id = 'econ-calendar-drop-zone';
  dropZone.style.cssText = `
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 400px;
    padding: 40px;
    background: #0a0f16;
    border: 2px dashed #00b4d8;
    border-radius: 8px;
    text-align: center;
    z-index: 99999;
    display: none;
    flex-direction: column;
    align-items: center;
    gap: 16px;
    font-family: monospace;
    box-shadow: 0 8px 32px rgba(0,0,0,0.8);
  `;
  dropZone.innerHTML = `
    <div style="font-size: 14px; color: #00e5ff; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase;">
      📅 ECONOMIC CALENDAR IMPORTER
    </div>
    <div style="font-size: 12px; color: #7a9bb5; line-height: 1.6;">
      <div>Drop .json file or screenshot image</div>
      <div style="color: #3a5570; margin-top: 8px; font-size: 11px;">
        JSON format: { "events": [ { "date", "time", "name", "period", "forecast", "prev" } ] }
      </div>
    </div>
    <input type="file" id="econ-file-input" accept=".json,image/*" style="display: none;">
    <button id="econ-close-importer" style="
      position: absolute;
      top: 12px;
      right: 12px;
      background: none;
      border: none;
      color: #3a5570;
      font-size: 20px;
      cursor: pointer;
    ">✕</button>
  `;

  document.body.appendChild(dropZone);

  // Drag-drop handlers
  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(evt => {
    dropZone.addEventListener(evt, e => {
      e.preventDefault();
      e.stopPropagation();
      if (evt === 'dragenter' || evt === 'dragover') {
        dropZone.style.background = '#0d1825';
        dropZone.style.borderColor = '#00e676';
      } else if (evt === 'dragleave') {
        dropZone.style.background = '#0a0f16';
        dropZone.style.borderColor = '#00b4d8';
      } else if (evt === 'drop') {
        handleFileDrop(e.dataTransfer.files);
      }
    });
  });

  // File input handler
  document.getElementById('econ-file-input').addEventListener('change', e => {
    handleFileDrop(e.target.files);
  });

  // Close button
  document.getElementById('econ-close-importer').addEventListener('click', () => {
    dropZone.style.display = 'none';
  });

  // Global keyboard shortcut: Ctrl+Shift+E to open importer
  window.toggleEconImporter = () => {
    dropZone.style.display = dropZone.style.display === 'none' ? 'flex' : 'none';
  };

  window.addEventListener('keydown', e => {
    if (e.ctrlKey && e.shiftKey && e.key === 'E') {
      e.preventDefault();
      window.toggleEconImporter();
    }
  });
}

async function persistEvents(events) {
  try {
    const res = await fetch('/api/econ-calendar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(events),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    showStatus(`✓ Saved ${data.count} events to server`, 'success');
    console.log('✓ Persisted to /api/econ-calendar:', data);
  } catch (err) {
    showStatus(`⚠️ Saved in memory only — server write failed: ${err.message}`, 'info');
    console.warn('persistEvents error:', err);
  }
}

async function handleFileDrop(files) {
  const file = files[0];
  if (!file) return;

  if (file.type === 'application/json') {
    loadFromJSON(file);
  } else if (file.type.startsWith('image/')) {
    loadFromScreenshot(file);
  } else {
    showStatus('❌ Only .json or image files supported', 'error');
  }
}

async function loadFromJSON(file) {
  try {
    const text = await file.text();
    console.log('File read, attempting parse...');
    console.log('Raw file content:', text.substring(0, 200));
    
    const data = JSON.parse(text);
    console.log('JSON parsed successfully:', data);

    if (!data.events || !Array.isArray(data.events)) {
      throw new Error('Invalid format: expected { "events": [...] }');
    }

    console.log(`Found ${data.events.length} events in JSON`);

    // Validate and normalize events - STRIP forecast/prev
    const normalized = data.events.map((ev, idx) => {
      const normalized = {
        date: ev.date || '',
        time: ev.time || '09:00',
        name: ev.name || 'Unnamed Event',
        period: ev.period || '',
      };
      console.log(`Event ${idx}:`, normalized);
      return normalized;
    });

    // Update global ECON_EVENTS
    window.ECON_EVENTS = normalized;
    showStatus(`✓ Loaded ${normalized.length} events — saving...`, 'success');

    // Persist to Next.js API (writes events.json on disk)
    await persistEvents(normalized);

    // Re-render calendar with retry logic
    let renderAttempts = 0;
    const tryRender = () => {
      if (window.renderEconCalendar) {
        window.renderEconCalendar();
      } else {
        renderAttempts++;
        if (renderAttempts < 5) setTimeout(tryRender, 500);
      }
    };
    tryRender();

    localStorage.setItem('ECON_EVENTS_BACKUP', JSON.stringify(normalized));
  } catch (err) {
    showStatus(`❌ ${err.message}`, 'error');
    console.error('Full error:', err);
    console.error('Stack:', err.stack);
  }
}

async function loadFromScreenshot(file) {
  try {
    showStatus('📸 Processing screenshot... (requires Tesseract.js)', 'info');

    // Load Tesseract if not already loaded
    if (!window.Tesseract) {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
      document.head.appendChild(script);
      await new Promise(r => script.onload = r);
    }

    const reader = new FileReader();
    reader.onload = async e => {
      try {
        const { data: { text } } = await Tesseract.recognize(
          e.target.result,
          'eng',
          { logger: () => {} }
        );

        console.log('=== RAW OCR TEXT ===');
        console.log(text);
        console.log('=== END RAW TEXT ===');

        // Parse OCR text → extract events
        const events = parseOCRText(text);
        
        console.log(`Parsed ${events.length} events`);
        if (events.length > 0) {
          console.log('Events:', events);
        }

        if (events.length === 0) {
          showStatus('⚠️ No events found. Check console for raw OCR text.', 'error');
          console.warn('Raw OCR text available above for manual inspection');
          return;
        }

        window.ECON_EVENTS = events;
        showStatus(`✓ Extracted ${events.length} events — saving...`, 'success');

        await persistEvents(events);

        if (window.renderEconCalendar) {
          window.renderEconCalendar();
        }

        localStorage.setItem('ECON_EVENTS_BACKUP', JSON.stringify(events));
      } catch (err) {
        showStatus(`❌ OCR failed: ${err.message}`, 'error');
        console.error(err);
      }
    };
    reader.readAsDataURL(file);
  } catch (err) {
    showStatus(`❌ ${err.message}`, 'error');
  }
}

// Improved OCR text parser - handles messy screenshots
function parseOCRText(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const events = [];
  let currentDate = null;

  // Patterns
  const dateRegex = /^([A-Z][A-Za-z]*),?\s+([A-Z][a-z]+)\s+(\d{1,2})$/i;
  const timeRegex = /^(\d{1,2}):(\d{2})\s*(am|pm|[APap]\.?[Mm]\.?)?/i;
  const monthNames = {
    'january': 1, 'february': 2, 'march': 3, 'april': 4, 'may': 5, 'june': 6,
    'july': 7, 'august': 8, 'september': 9, 'october': 10, 'november': 11, 'december': 12,
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Try to match date line
    const dateMatch = line.match(dateRegex);
    if (dateMatch) {
      const [_, dayName, monthName, dateNum] = dateMatch;
      const monthNum = monthNames[monthName.toLowerCase()];
      if (monthNum) {
        currentDate = `2026-${String(monthNum).padStart(2, '0')}-${String(parseInt(dateNum)).padStart(2, '0')}`;
        console.log(`Detected date: ${line} → ${currentDate}`);
      }
      continue;
    }

    // Try to match time + event
    const timeMatch = line.match(timeRegex);
    if (timeMatch && currentDate) {
      const [fullMatch, h, m, period] = timeMatch;
      let hour = parseInt(h);
      
      // Handle AM/PM
      if (period) {
        const pm = period.toLowerCase().includes('p');
        if (pm && hour !== 12) hour += 12;
        if (!pm && hour === 12) hour = 0;
      }

      const time = `${String(hour).padStart(2, '0')}:${m}`;
      
      // Event name is the rest of current line (after time) or next line
      let eventName = line.replace(fullMatch, '').trim();
      if (!eventName && i + 1 < lines.length) {
        eventName = lines[i + 1];
        i++; // Skip next line
      }
      if (!eventName) eventName = 'Economic Event';

      events.push({
        date: currentDate,
        time: time,
        name: eventName.substring(0, 80),
        period: '',
        forecast: '—',
        prev: '—',
      });

      console.log(`Parsed event: ${time} → ${eventName}`);
    }
  }

  console.log(`Total events parsed: ${events.length}`);
  return events;
}

function getMonthNumber(monthName) {
  const months = {
    'JANUARY': 1, 'FEBRUARY': 2, 'MARCH': 3, 'APRIL': 4, 'MAY': 5, 'JUNE': 6,
    'JULY': 7, 'AUGUST': 8, 'SEPTEMBER': 9, 'OCTOBER': 10, 'NOVEMBER': 11, 'DECEMBER': 12,
  };
  return months[monthName.toUpperCase()] || 1;
}

function showStatus(msg, type = 'info') {
  const toast = document.createElement('div');
  const colors = {
    info: '#00b4d8',
    success: '#00e676',
    error: '#ff3355',
  };
  toast.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    padding: 12px 20px;
    background: #0a0f16;
    border: 2px solid ${colors[type]};
    color: ${colors[type]};
    border-radius: 4px;
    font-size: 12px;
    font-family: monospace;
    z-index: 100000;
    animation: slideIn 0.3s ease-out;
  `;
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

// Add button to topbar menu
function addImporterButton() {
  const menuDiv = document.getElementById('topbar-dd-menu');
  if (!menuDiv) {
    setTimeout(addImporterButton, 500); // Retry if menu not found
    return;
  }

  // Create separator
  const sep = document.createElement('div');
  sep.style.cssText = 'padding:6px 10px;border-bottom:1px solid #1a2a3a';
  
  // Create button
  const btn = document.createElement('button');
  btn.textContent = '📅 Import Calendar Events';
  btn.style.cssText = `
    width: 100%;
    padding: 8px 10px;
    border: none;
    background: transparent;
    color: #00e5ff;
    font-size: 12px;
    cursor: pointer;
    text-align: left;
    font-family: inherit;
    font-weight: 600;
    transition: all 0.15s ease;
  `;
  btn.onmouseover = () => {
    btn.style.background = 'rgba(0, 180, 216, 0.12)';
  };
  btn.onmouseout = () => {
    btn.style.background = 'transparent';
  };
  btn.onclick = () => {
    window.toggleEconImporter();
    document.getElementById('topbar-dd-menu').style.display = 'none';
  };

  sep.appendChild(btn);
  menuDiv.appendChild(sep);
}

// Init on load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    initCalendarImporter();
    addImporterButton();
  });
} else {
  initCalendarImporter();
  addImporterButton();
}
