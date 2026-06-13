# SQLite Snapshot API Endpoints

## Overview
The Estimated Moves page now uses SQLite (via API endpoints) instead of IndexedDB for persisting snapshots. This document defines the required backend API endpoints.

---

## Database Schema

### snapshots table

```sql
CREATE TABLE snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp INTEGER NOT NULL,
  date TEXT NOT NULL,
  time TEXT NOT NULL,
  period TEXT NOT NULL DEFAULT 'weekly',
  tableHtml TEXT NOT NULL,
  expirations TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

**Fields:**
- `id` - Auto-incrementing primary key
- `timestamp` - JavaScript timestamp (getTime())
- `date` - Locale date string (e.g., "6/12/2026")
- `time` - Locale time string (e.g., "03:45:23 PM")
- `period` - Period type ("weekly", "daily", etc.)
- `tableHtml` - Full HTML of table rows (serialized)
- `expirations` - JSON array of expiration dates
- `created_at` - Server timestamp (for sorting/cleanup)

---

## API Endpoints

### 1. POST /api/snapshots
**Save a new snapshot**

Request:
```json
{
  "timestamp": 1718186723000,
  "date": "6/12/2026",
  "time": "03:45:23 PM",
  "period": "weekly",
  "tableHtml": "<tr>...</tr>...",
  "expirations": ["2026-06-19", "2026-06-26"]
}
```

Response (201 Created):
```json
{
  "id": 42,
  "timestamp": 1718186723000,
  "date": "6/12/2026",
  "time": "03:45:23 PM",
  "period": "weekly",
  "tableHtml": "<tr>...</tr>...",
  "expirations": ["2026-06-19", "2026-06-26"],
  "message": "Snapshot saved"
}
```

**Error Responses:**
- `400 Bad Request` - Invalid JSON or missing required fields
- `500 Internal Server Error` - Database write error

---

### 2. GET /api/snapshots?period=weekly
**Retrieve all snapshots for a period**

Query Parameters:
- `period` (optional) - Filter by period ("weekly", "daily", etc.). Default: all

Response (200 OK):
```json
[
  {
    "id": 42,
    "timestamp": 1718186723000,
    "date": "6/12/2026",
    "time": "03:45:23 PM",
    "period": "weekly",
    "tableHtml": "<tr>...</tr>...",
    "expirations": ["2026-06-19", "2026-06-26"]
  },
  {
    "id": 41,
    "timestamp": 1718100000000,
    "date": "6/11/2026",
    "time": "02:30:15 PM",
    "period": "weekly",
    "tableHtml": "<tr>...</tr>...",
    "expirations": ["2026-06-19", "2026-06-26"]
  }
]
```

**Notes:**
- Results are returned in reverse chronological order (newest first)
- `expirations` is returned as a JSON array (parsed from stored string)
- If no snapshots exist, return empty array `[]`

**Error Responses:**
- `500 Internal Server Error` - Database read error

---

### 3. GET /api/snapshots/:id
**Retrieve a specific snapshot by ID**

Response (200 OK):
```json
{
  "id": 42,
  "timestamp": 1718186723000,
  "date": "6/12/2026",
  "time": "03:45:23 PM",
  "period": "weekly",
  "tableHtml": "<tr>...</tr>...",
  "expirations": ["2026-06-19", "2026-06-26"]
}
```

**Error Responses:**
- `404 Not Found` - Snapshot ID does not exist
- `500 Internal Server Error` - Database error

---

### 4. DELETE /api/snapshots/:id
**Delete a snapshot by ID**

Response (200 OK):
```json
{
  "id": 42,
  "message": "Snapshot deleted"
}
```

**Error Responses:**
- `404 Not Found` - Snapshot ID does not exist
- `500 Internal Server Error` - Database error

---

### 5. POST /api/discord-webhook
**Post estimated moves image to Discord**

Request:
```
Content-Type: multipart/form-data

payload_json: {"content": "Weekly Estimated Moves — 6/14"}
file1: <PNG blob>
```

Response (200 OK):
```json
{
  "message": "Posted to Discord"
}
```

**Error Responses:**
- `400 Bad Request` - Missing payload_json or file
- `500 Internal Server Error` - Webhook error
- `503 Service Unavailable` - Discord API down

**Notes:**
- Requires webhook URL configured in environment (env var: `DISCORD_WEBHOOK_URL`)
- Only one file supported (file1)

---

## Implementation Notes

### Data Types
- `timestamp` - Stored as INTEGER (milliseconds since epoch)
- `expirations` - Stored as JSON string, parsed on retrieval
- `tableHtml` - Full HTML string, can be very large (~10KB+)

### Sorting & Ordering
- Always return snapshots in **reverse chronological order** (newest first)
- Sort by `id DESC` or `created_at DESC`

### Pagination (Optional)
- Consider adding `?limit=10&offset=0` for large snapshot lists
- Current implementation doesn't require pagination but frontend can support it

### Auto-Cleanup (Optional)
- Consider purging snapshots older than 30 days
- Run as daily cron job: `DELETE FROM snapshots WHERE created_at < NOW() - INTERVAL '30 days'`

### Indexing
Add these indexes for performance:
```sql
CREATE INDEX idx_snapshots_period ON snapshots(period);
CREATE INDEX idx_snapshots_created_at ON snapshots(created_at DESC);
CREATE INDEX idx_snapshots_timestamp ON snapshots(timestamp DESC);
```

---

## Frontend Usage

### Save Snapshot
```javascript
const response = await fetch('/api/snapshots', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    timestamp: Date.now(),
    date: new Date().toLocaleDateString('en-US'),
    time: new Date().toLocaleTimeString('en-US', {hour:'2-digit', minute:'2-digit', second:'2-digit'}),
    period: 'weekly',
    tableHtml: document.getElementById('em-table-body').innerHTML,
    expirations: EM.knownExpirations.slice(0, 3)
  })
});
const snapshot = await response.json();
```

### Load Snapshots
```javascript
const response = await fetch('/api/snapshots?period=weekly');
const snapshots = await response.json(); // Returns array, reversed
```

### Delete Snapshot
```javascript
const response = await fetch(`/api/snapshots/${id}`, { method: 'DELETE' });
if (response.ok) {
  // Refresh list
}
```

### Post to Discord
```javascript
const canvas = await EM.captureShareCanvas(); // Returns HTMLCanvasElement
const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
const form = new FormData();
form.append('payload_json', JSON.stringify({ content: 'Weekly Estimated Moves — 6/14' }));
form.append('file1', blob, 'estimated-moves.png');
const response = await fetch('/api/discord-webhook', { method: 'POST', body: form });
```

---

## Migration from IndexedDB

If migrating from IndexedDB:

```javascript
// Export from IndexedDB
const db = await new Promise((resolve, reject) => {
  const req = indexedDB.open('EM_Dashboard', 1);
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

const tx = db.transaction(['snapshots'], 'readonly');
const store = tx.objectStore('snapshots');
const req = store.getAll();

req.onsuccess = async () => {
  const snapshots = req.result;
  // POST each to /api/snapshots
  for (const snap of snapshots) {
    await fetch('/api/snapshots', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(snap)
    });
  }
};
```

---

## Error Handling

Always return structured JSON errors:

```json
{
  "error": "Snapshot not found",
  "code": 404,
  "details": "ID 999 does not exist"
}
```

Common HTTP Status Codes:
- `200 OK` - Successful GET/DELETE
- `201 Created` - Successful POST
- `400 Bad Request` - Invalid input
- `404 Not Found` - Resource doesn't exist
- `500 Internal Server Error` - Database/server error
- `503 Service Unavailable` - External service (Discord) down

---

## Testing

### Test Save
```bash
curl -X POST http://localhost:3000/api/snapshots \
  -H "Content-Type: application/json" \
  -d '{
    "timestamp": 1718186723000,
    "date": "6/12/2026",
    "time": "03:45:23 PM",
    "period": "weekly",
    "tableHtml": "<tr><td>SPX</td></tr>",
    "expirations": ["2026-06-19"]
  }'
```

### Test Retrieve
```bash
curl http://localhost:3000/api/snapshots?period=weekly
```

### Test Delete
```bash
curl -X DELETE http://localhost:3000/api/snapshots/1
```

