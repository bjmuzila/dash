// ===========================
// GLOBAL APP STATE & UTILITIES
// ===========================
// Shared state management, event bus, and utility functions

// Global state
window.AppState = {
  spotPrice: 0,
  rawChain: [],
  expiryMap: {},
  selectedDTE: 0,
  autoRefreshEnabled: true,
  autoRefreshInterval: 30,
  currentPage: 'overview'
};

// Event bus for cross-component communication
const eventBus = {
  events: {},
  
  on(event, callback) {
    if (!this.events[event]) {
      this.events[event] = [];
    }
    this.events[event].push(callback);
  },
  
  emit(event, data) {
    if (this.events[event]) {
      this.events[event].forEach(callback => callback(data));
    }
  },
  
  off(event, callback) {
    if (this.events[event]) {
      this.events[event] = this.events[event].filter(cb => cb !== callback);
    }
  }
};

window.EventBus = eventBus;

// Safe element setter
function safeSet(id, content) {
  const el = document.getElementById(id);
  if (el) {
    if (typeof content === 'string') {
      el.textContent = content;
    } else {
      el.innerHTML = content;
    }
  } else {
    console.warn(`Element not found: ${id}`);
  }
}

window.safeSet = safeSet;

// Clock update
function updateClock() {
  const now = new Date();
  const time = now.toLocaleTimeString('en-US', { 
    hour: '2-digit', 
    minute: '2-digit', 
    second: '2-digit',
    hour12: false,
    timeZone: 'America/New_York'
  });
  
  safeSet('est-clock', time);
  
  // Determine session
  const hour = now.getHours();
  const session = hour >= 9 && hour < 16 ? 'RTH' : 
                  hour >= 16 || hour < 9 ? 'AH' : 'PRE';
  safeSet('est-session', session);
}

// Start clock
setInterval(updateClock, 1000);
updateClock();

// Auto-refresh countdown
let autoRefreshCountdown = 30;
let autoRefreshTimer = null;

function startAutoRefresh() {
  if (autoRefreshTimer) clearInterval(autoRefreshTimer);
  
  autoRefreshCountdown = window.AppState.autoRefreshInterval;
  
  autoRefreshTimer = setInterval(() => {
    if (!window.AppState.autoRefreshEnabled) return;
    
    autoRefreshCountdown--;
    safeSet('countdown-val', `${autoRefreshCountdown}s`);
    
    const pct = (autoRefreshCountdown / window.AppState.autoRefreshInterval) * 100;
    const bar = document.getElementById('countdown-bar');
    if (bar) bar.style.width = `${pct}%`;
    
    if (autoRefreshCountdown <= 0) {
      manualRefresh();
      autoRefreshCountdown = window.AppState.autoRefreshInterval;
    }
  }, 1000);
}

function toggleAutoRefresh() {
  window.AppState.autoRefreshEnabled = !window.AppState.autoRefreshEnabled;
  const btn = document.getElementById('auto-toggle-btn');
  if (btn) {
    btn.textContent = window.AppState.autoRefreshEnabled ? '⏸ Pause' : '▶ Resume';
  }
}

function manualRefresh() {
  console.log('Manual refresh triggered');
  eventBus.emit('refresh-data');
  autoRefreshCountdown = window.AppState.autoRefreshInterval;
}

window.toggleAutoRefresh = toggleAutoRefresh;
window.manualRefresh = manualRefresh;

// Start auto-refresh on load
window.addEventListener('DOMContentLoaded', () => {
  startAutoRefresh();
});

// Navigation helper (called by individual pages)
function switchPage(pageName, element) {
  // Update nav items
  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.remove('active');
  });
  
  if (element) {
    element.classList.add('active');
  }
  
  // Hide all pages
  document.querySelectorAll('[id^="page-"]').forEach(page => {
    page.style.display = 'none';
  });
  
  // Show selected page
  const targetPage = document.getElementById(`page-${pageName}`);
  if (targetPage) {
    targetPage.style.display = 'flex';
    window.AppState.currentPage = pageName;
    eventBus.emit('page-changed', pageName);
  }
}

window.switchPage = switchPage;

// Utility: Get DTE from date string
function getDTE(dateStr) {
  const expiry = new Date(dateStr + 'T16:00:00');
  const now = new Date();
  const diff = expiry - now;
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

window.getDTE = getDTE;

// Utility: Format DTE display
function formatDTE(dateStr) {
  const dte = getDTE(dateStr);
  if (dte === 0) return '0DTE';
  if (dte === 1) return '1DTE';
  return `${dte}DTE`;
}

window.formatDTE = formatDTE;

// ─── PAGE LOADING ───
function loadPage(pageName) {
  console.log(`Loading page: ${pageName}`);
  
  // Update nav active state
  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.remove('active');
  });
  const navItem = document.getElementById(`nav-${pageName}`);
  if (navItem) navItem.classList.add('active');
  
  // Load page content
  const contentPanel = document.getElementById('content-panel');
  if (!contentPanel) return;
  
  fetch(`pages/${pageName}.html`)
    .then(r => r.text())
    .then(html => {
      contentPanel.innerHTML = html;
      window.AppState.currentPage = pageName;
      eventBus.emit('page-loaded', pageName);
      
      // Execute any scripts in the loaded page
      const scripts = contentPanel.querySelectorAll('script');
      scripts.forEach(script => {
        const newScript = document.createElement('script');
        newScript.textContent = script.textContent;
        document.body.appendChild(newScript);
      });
    })
    .catch(err => {
      console.error(`Failed to load page ${pageName}:`, err);
      contentPanel.innerHTML = `<div style="padding:20px;color:var(--text2)">Failed to load ${pageName}</div>`;
    });
}

window.loadPage = loadPage;

// ─── DTE FILTER MANAGEMENT ───
let currentDTEFilter = null;

function setDTEGEXView(dte, element) {
  console.log(`Setting DTE filter: ${dte}`);
  
  // Update active pill
  document.querySelectorAll('#dte-gex-pills .nav-pill').forEach(pill => {
    pill.classList.remove('active');
  });
  if (element) element.classList.add('active');
  
  // Store selection
  if (dte === 'combined') {
    currentDTEFilter = 'combined';
    localStorage.setItem('dteGexView', 'combined');
  } else {
    currentDTEFilter = parseInt(dte);
    localStorage.setItem('dteGexView', dte);
  }
  
  // Emit event for pages to react
  eventBus.emit('dte-filter-changed', currentDTEFilter);
}

window.setDTEGEXView = setDTEGEXView;

// ─── STRIKE COUNT FILTER ───
function updateStrikeCount() {
  const input = document.getElementById('strike-count-input');
  if (!input) return;
  
  const count = parseInt(input.value) || 40;
  localStorage.setItem('strikeCount', count);
  eventBus.emit('strike-count-changed', count);
  console.log(`Strike count updated: ${count}`);
}

window.updateStrikeCount = updateStrikeCount;

// ─── PEAK GEX RECORDER ───
let gexPeaks = [];

function gexTakeSnapshot() {
  if (!window.AppState.rawChain || window.AppState.rawChain.length === 0) {
    console.warn('No chain data to snapshot');
    return;
  }
  
  // Find current max GEX strike
  const sorted = [...window.AppState.rawChain].sort((a, b) => 
    Math.abs(b.netGEX || 0) - Math.abs(a.netGEX || 0)
  );
  
  const peak = sorted[0];
  if (!peak) return;
  
  const snapshot = {
    strike: peak.strike,
    gex: peak.netGEX,
    timestamp: Date.now()
  };
  
  gexPeaks.unshift(snapshot);
  if (gexPeaks.length > 5) gexPeaks.pop();
  
  // Save to localStorage
  localStorage.setItem('gexPeaks', JSON.stringify(gexPeaks));
  
  // Update display
  renderGexPeaks();
  
  console.log('GEX snapshot taken:', snapshot);
}

function renderGexPeaks() {
  const list = document.getElementById('gex-peak-list');
  if (!list) return;
  
  list.innerHTML = gexPeaks.map(p => {
    const time = new Date(p.timestamp).toLocaleTimeString('en-US', { 
      hour: '2-digit', 
      minute: '2-digit',
      hour12: false 
    });
    return `<span style="font-size:11px;padding:2px 6px;background:#0a1420;border:1px solid #1e3050;border-radius:2px;color:#00e5ff">${p.strike} <span style="color:#3a5570">@${time}</span></span>`;
  }).join('');
}

// Load saved peaks on init
try {
  const saved = localStorage.getItem('gexPeaks');
  if (saved) {
    gexPeaks = JSON.parse(saved);
    renderGexPeaks();
  }
} catch (e) {
  console.warn('Failed to load saved GEX peaks');
}

window.gexTakeSnapshot = gexTakeSnapshot;

console.log('App state and utilities loaded');
