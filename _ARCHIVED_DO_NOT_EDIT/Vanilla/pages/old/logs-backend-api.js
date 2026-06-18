// LOGS PAGE BACKEND API ENDPOINTS
// Add these routes to your Express server

const express = require('express');
const fs = require('fs').promises;
const path = require('path');

const router = express.Router();

// Data file location
const DATA_FILE = path.join(process.cwd(), 'data', 'logs.json');

// Ensure data directory exists
async function ensureDataDir() {
  try {
    await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
  } catch (e) {
    console.error('Failed to create data directory:', e);
  }
}

// Load all logs
async function loadAllLogs() {
  try {
    const data = await fs.readFile(DATA_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (e) {
    // File doesn't exist or is invalid, return empty structure
    return { telemetry: [], ideas: [] };
  }
}

// Save all logs
async function saveAllLogs(data) {
  await ensureDataDir();
  await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2));
}

// GET all logs
router.get('/personal-logs', async (req, res) => {
  try {
    const data = await loadAllLogs();
    res.json(data);
  } catch (e) {
    console.error('GET logs error:', e);
    res.status(500).json({ error: 'Failed to load logs' });
  }
});

// POST telemetry log
router.post('/personal-logs/telemetry', async (req, res) => {
  try {
    const { content, timestamp, id } = req.body;
    
    if (!content || !timestamp) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    const data = await loadAllLogs();
    
    // Check if entry already exists (duplicate prevention)
    const exists = data.telemetry.some(log => log.id === id);
    if (!exists) {
      data.telemetry.unshift({
        id: id || Date.now(),
        content,
        timestamp,
        type: 'telemetry',
        createdAt: new Date().toISOString()
      });
    }
    
    await saveAllLogs(data);
    res.json({ success: true, entry: data.telemetry[0] });
  } catch (e) {
    console.error('POST telemetry error:', e);
    res.status(500).json({ error: 'Failed to save telemetry' });
  }
});

// POST idea
router.post('/personal-logs/ideas', async (req, res) => {
  try {
    const { content, timestamp, id } = req.body;
    
    if (!content || !timestamp) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    const data = await loadAllLogs();
    
    // Check if entry already exists (duplicate prevention)
    const exists = data.ideas.some(idea => idea.id === id);
    if (!exists) {
      data.ideas.unshift({
        id: id || Date.now(),
        content,
        timestamp,
        type: 'idea',
        createdAt: new Date().toISOString()
      });
    }
    
    await saveAllLogs(data);
    res.json({ success: true, entry: data.ideas[0] });
  } catch (e) {
    console.error('POST idea error:', e);
    res.status(500).json({ error: 'Failed to save idea' });
  }
});

// DELETE telemetry log
router.delete('/personal-logs/telemetry/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const data = await loadAllLogs();
    
    data.telemetry = data.telemetry.filter(log => log.id !== id);
    
    await saveAllLogs(data);
    res.json({ success: true });
  } catch (e) {
    console.error('DELETE telemetry error:', e);
    res.status(500).json({ error: 'Failed to delete telemetry' });
  }
});

// DELETE idea
router.delete('/personal-logs/idea/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const data = await loadAllLogs();
    
    data.ideas = data.ideas.filter(idea => idea.id !== id);
    
    await saveAllLogs(data);
    res.json({ success: true });
  } catch (e) {
    console.error('DELETE idea error:', e);
    res.status(500).json({ error: 'Failed to delete idea' });
  }
});

module.exports = router;

// ============================================
// INTEGRATION INSTRUCTIONS
// ============================================
// 
// In your main Express app file:
// 
//   const logsRouter = require('./routes/logs');
//   app.use('/proxy/api', logsRouter);
//
// ============================================
