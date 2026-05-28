'use strict';

// Excel export endpoint
const express = require('express');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');

const app = express();
app.use(express.json());

const EXPORT_DIR = path.join(__dirname, 'MVC');
if (!fs.existsSync(EXPORT_DIR)) {
  fs.mkdirSync(EXPORT_DIR, { recursive: true });
}

app.get('/health', (_req, res) => {
  res.json({ ok: true, exportDir: EXPORT_DIR });
});

app.post('/export-mvc', (req, res) => {
  try {
    const { data, filename } = req.body;
    
    if (!data || !filename) {
      return res.status(400).json({ error: 'Missing data or filename' });
    }

    // Create workbook
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, 'Snapshots');

    // Save to file
    const filepath = path.join(EXPORT_DIR, filename);
    XLSX.writeFile(wb, filepath);

    console.log(`✓ MVC snapshots exported to ${filepath}`);
    res.json({ success: true, message: `Saved to ${filepath}` });
  } catch (err) {
    console.error('Export failed:', err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(3002, () => {
  console.log('Export service running on port 3002');
});
