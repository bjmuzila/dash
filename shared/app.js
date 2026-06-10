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
  strikeCount: 0,
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
window.PageRuntime = window.PageRuntime || {
  cleanupHandlers: new Map(),
  register(name, cleanup) {
    if (!name || typeof cleanup !== 'function') return;
    this.cleanupHandlers.set(name, cleanup);
  },
  cleanup(name) {
    const fn = this.cleanupHandlers.get(name);
    if (typeof fn === 'function') {
      try {
        fn();
      } catch (err) {
        console.warn(`Page cleanup failed for ${name}:`, err);
      }
    }
    this.cleanupHandlers.delete(name);
  }
};

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

// Clock update — DISABLED. overview.js has the canonical 12-hour clock with proper session labels.
// Leaving the function defined but not started, to avoid breaking anything that might call it.
function updateClock() {
  // no-op — see overview.js updateESTClock
}

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

console.log('App state and utilities loaded');
