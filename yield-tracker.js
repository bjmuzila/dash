/**
 * YIELD CHANGE TRACKER (2-Day Rolling)
 * Stores daily US10Y yields and calculates 2-day momentum
 * 
 * Integration: Run on your Node.js backend / Firebase
 * Purpose: Feed 2-day yield change to Vol Trend Probability Engine
 */

const fs = require('fs');
const path = require('path');

// Path to persistent yield history file
const YIELD_HISTORY_FILE = path.join(__dirname, 'yield_history.json');

/**
 * Yield data structure
 * {
 *   "2025-05-28": { yield: 4.57, timestamp: "2025-05-28T16:00:00Z" },
 *   "2025-05-27": { yield: 4.49, timestamp: "2025-05-27T16:00:00Z" },
 *   ...
 * }
 */

/**
 * Load yield history from disk
 */
function loadYieldHistory() {
    try {
        if (fs.existsSync(YIELD_HISTORY_FILE)) {
            const data = fs.readFileSync(YIELD_HISTORY_FILE, 'utf8');
            return JSON.parse(data);
        }
    } catch (e) {
        console.error('Failed to load yield history:', e);
    }
    return {};
}

/**
 * Save yield history to disk
 */
function saveYieldHistory(history) {
    try {
        fs.writeFileSync(YIELD_HISTORY_FILE, JSON.stringify(history, null, 2));
    } catch (e) {
        console.error('Failed to save yield history:', e);
    }
}

/**
 * Get today's date as YYYY-MM-DD
 */
function getTodayKey() {
    const now = new Date();
    return now.toISOString().split('T')[0];
}

/**
 * Record today's US10Y yield
 * Call this once per day, ideally at market close (4 PM ET)
 * 
 * @param {number} yieldValue - US10Y yield as decimal (e.g., 4.57)
 */
function recordDailyYield(yieldValue) {
    const history = loadYieldHistory();
    const todayKey = getTodayKey();
    
    history[todayKey] = {
        yield: parseFloat(yieldValue),
        timestamp: new Date().toISOString()
    };
    
    saveYieldHistory(history);
    console.log(`[Yield Tracker] Recorded US10Y: ${yieldValue}% on ${todayKey}`);
    return history;
}

/**
 * Calculate 2-day yield change in basis points
 * Returns: (Today's Close - 2-Days-Ago Close) * 100
 * 
 * @returns {number} Basis point change (e.g., +8 or -6)
 */
function calculate2DayYieldChange() {
    const history = loadYieldHistory();
    const todayKey = getTodayKey();
    
    // Get today's yield
    const todayEntry = history[todayKey];
    if (!todayEntry) {
        console.warn('[Yield Tracker] No yield recorded for today yet');
        return 0;
    }
    
    const todayYield = todayEntry.yield;
    
    // Calculate 2 days ago (skip weekends)
    const today = new Date();
    let twoDaysAgo = new Date(today);
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
    
    // If 2 days ago was a weekend, backtrack further
    while (twoDaysAgo.getDay() === 0 || twoDaysAgo.getDay() === 6) {
        twoDaysAgo.setDate(twoDaysAgo.getDate() - 1);
    }
    
    const twoDaysAgoKey = twoDaysAgo.toISOString().split('T')[0];
    const twoDaysAgoEntry = history[twoDaysAgoKey];
    
    if (!twoDaysAgoEntry) {
        console.warn(`[Yield Tracker] No yield data for 2 days ago (${twoDaysAgoKey})`);
        return 0;
    }
    
    const twoDaysAgoYield = twoDaysAgoEntry.yield;
    const changeBps = (todayYield - twoDaysAgoYield) * 100;
    
    console.log(`[Yield Tracker] 2-Day Change: ${todayYield.toFixed(2)}% - ${twoDaysAgoYield.toFixed(2)}% = ${changeBps.toFixed(1)} bps`);
    return Math.round(changeBps);
}

/**
 * Get full yield history for dashboard display
 */
function getYieldHistory(limit = 20) {
    const history = loadYieldHistory();
    const entries = Object.entries(history)
        .sort((a, b) => new Date(b[0]) - new Date(a[0]))
        .slice(0, limit);
    
    return Object.fromEntries(entries);
}

/**
 * Express.js endpoint handler
 * POST /api/yield/record
 */
function handleYieldRecord(req, res) {
    try {
        const { yield_value } = req.body;
        
        if (typeof yield_value !== 'number' || yield_value < 0 || yield_value > 10) {
            return res.status(400).json({ error: 'Invalid yield value' });
        }
        
        recordDailyYield(yield_value);
        const change2d = calculate2DayYieldChange();
        
        res.json({
            success: true,
            recorded_yield: yield_value,
            change_2d_bps: change2d,
            timestamp: new Date().toISOString()
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
}

/**
 * Express.js endpoint handler
 * GET /api/yield/change-2d
 */
function handleYieldChange2D(req, res) {
    try {
        const change2d = calculate2DayYieldChange();
        const history = loadYieldHistory();
        const todayKey = getTodayKey();
        const todayYield = history[todayKey];
        
        res.json({
            change_2d_bps: change2d,
            today_yield: todayYield?.yield || null,
            timestamp: new Date().toISOString()
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
}

/**
 * Express.js endpoint handler
 * GET /api/yield/history
 */
function handleYieldHistory(req, res) {
    try {
        const limit = parseInt(req.query.limit) || 20;
        const history = getYieldHistory(limit);
        
        res.json({
            history,
            count: Object.keys(history).length,
            timestamp: new Date().toISOString()
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
}

// ============================================================================
// INITIALIZATION: Bootstrap example yield data for testing
// ============================================================================

function initializeWithTestData() {
    const history = loadYieldHistory();
    
    // Only populate if empty
    if (Object.keys(history).length === 0) {
        console.log('[Yield Tracker] Bootstrapping test data...');
        
        const testData = {
            '2025-05-22': { yield: 4.52, timestamp: '2025-05-22T16:00:00Z' },
            '2025-05-23': { yield: 4.58, timestamp: '2025-05-23T16:00:00Z' },
            '2025-05-24': { yield: 4.55, timestamp: '2025-05-24T16:00:00Z' },
            '2025-05-25': { yield: 4.55, timestamp: '2025-05-25T16:00:00Z' }, // Sunday (no market)
            '2025-05-26': { yield: 4.55, timestamp: '2025-05-26T16:00:00Z' }, // Monday (no data yet, use Friday's)
            '2025-05-27': { yield: 4.49, timestamp: '2025-05-27T16:00:00Z' }, // Tuesday (yesterday's close)
            '2025-05-28': { yield: 4.57, timestamp: '2025-05-28T16:00:00Z' }  // Wednesday (today's close)
        };
        
        saveYieldHistory(testData);
        console.log('[Yield Tracker] Test data initialized');
    }
}

// Initialize on module load
initializeWithTestData();

module.exports = {
    recordDailyYield,
    calculate2DayYieldChange,
    getYieldHistory,
    loadYieldHistory,
    handleYieldRecord,
    handleYieldChange2D,
    handleYieldHistory
};

// ============================================================================
// EXAMPLE: Integration into Express.js server
// ============================================================================
/*
const express = require('express');
const yieldTracker = require('./yield-tracker');

const app = express();
app.use(express.json());

// Record a daily yield (call at 4 PM ET)
app.post('/api/yield/record', yieldTracker.handleYieldRecord);

// Get 2-day yield change (for Vol Trend dashboard)
app.get('/api/yield/change-2d', yieldTracker.handleYieldChange2D);

// Get historical yields
app.get('/api/yield/history', yieldTracker.handleYieldHistory);

app.listen(3000, () => console.log('Yield tracker running on port 3000'));
*/
