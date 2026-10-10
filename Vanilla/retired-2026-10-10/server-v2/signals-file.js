'use strict';
/**
 * server-v2/signals-file.js
 *
 * Single mutexed writer for public/signals.txt.
 *
 * WHY THIS EXISTS: signals.txt is a read-modify-write file, and there is now
 * more than one producer (econ-alert-recorder every 20s, greeks-cross-alerts
 * every 30s). Two independent readModifyWrite cycles on the same file WILL
 * clobber each other — whoever writes second wins and silently drops the other's
 * lines. Every producer must go through appendAutoLines() here.
 *
 * Each producer owns a named block, delimited by its own markers, so producers
 * never touch each other's lines:
 *
 *   # --- AUTO ECON ALERTS (start, do not hand-edit) ---
 *   ...
 *   # --- AUTO ECON ALERTS (end) ---
 *   # --- AUTO GREEKS ALERTS (start, do not hand-edit) ---
 *   ...
 *   # --- AUTO GREEKS ALERTS (end) ---
 *
 * Hand-authored lines live outside every block and are never rewritten.
 *
 * The mutex is in-process only — that's sufficient because every producer runs
 * inside the single server-with-proxy.js process.
 */

const fs = require('fs');
const path = require('path');

const SIGNALS_PATH = path.join(__dirname, '..', 'public', 'signals.txt');
const DEFAULT_MAX_LINES = 40;

// Registered blocks. `name` becomes the marker text.
const markers = (name) => ({
  start: `# --- AUTO ${name} ALERTS (start, do not hand-edit) ---`,
  end: `# --- AUTO ${name} ALERTS (end) ---`,
});

// Serialize all writes: each call chains onto the previous one's completion, so
// no two read-modify-write cycles can interleave.
let queue = Promise.resolve();

/**
 * Append lines to a named AUTO block, keeping only the most recent maxLines.
 * @param {string} name       block name, e.g. 'ECON' or 'GREEKS'
 * @param {string[]} newLines signal lines to append
 * @param {number} maxLines   cap for this block
 * @returns {Promise<void>}
 */
function appendAutoLines(name, newLines, maxLines = DEFAULT_MAX_LINES) {
  if (!newLines || !newLines.length) return Promise.resolve();

  queue = queue.then(() => {
    const { start: BLOCK_START, end: BLOCK_END } = markers(name);

    let content = '';
    try { content = fs.readFileSync(SIGNALS_PATH, 'utf-8'); } catch { content = ''; }

    const startIdx = content.indexOf(BLOCK_START);
    const endIdx = content.indexOf(BLOCK_END);

    let existing = [];
    let head = content;
    let tail = '';
    if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
      head = content.slice(0, startIdx).replace(/\s*$/, '');
      tail = content.slice(endIdx + BLOCK_END.length);
      const inner = content.slice(startIdx + BLOCK_START.length, endIdx);
      existing = inner.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    }

    const merged = [...existing, ...newLines].slice(-maxLines);
    const block = `${BLOCK_START}\n${merged.join('\n')}\n${BLOCK_END}`;
    const out = `${head}\n\n${block}${tail}`;

    // Write via temp + rename so a reader (the Next route serving /signals.txt,
    // or discord-relay) can never observe a half-written file.
    const tmp = `${SIGNALS_PATH}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, out, 'utf-8');
    fs.renameSync(tmp, SIGNALS_PATH);
  }).catch((e) => {
    console.warn('[signals-file] write failed:', e.message);
  });

  return queue;
}

module.exports = { appendAutoLines, SIGNALS_PATH };
