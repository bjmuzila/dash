'use strict';
/**
 * server-v2/client-sites.js — backend for the owner "Client Sites" page
 * (owner-vite/src/pages/ClientSites.tsx) that manages sites.cbedge.net.
 *
 * sites.cbedge.net is the `demo-sites` nginx container. Each client is one
 * folder of static files plus one htpasswd file, and nginx.conf maps
 * /<slug>/ onto both generically — so creating a site here is just writing
 * files. Nothing is rebuilt or restarted.
 *
 *   /demo-sites/sites/<slug>/index.html   (host: /opt/demo-sites-data)  — the site
 *   /demo-sites/auth/<slug>.htpasswd      (host: /opt/demo-sites-auth)  — its logins
 *   /demo-sites/auth/<slug>.json          (host: /opt/demo-sites-auth)  — label + dates
 *
 * Both host folders live OUTSIDE the git checkout on purpose: writing into
 * /opt/dashboard would leave a dirty working tree for the next `git pull` /
 * `docker compose build` to trip over. They are bind-mounted read/write into
 * the dashboard container (docker-compose.yml → dashboard.volumes) and
 * read-only into demo-sites.
 *
 * Passwords are bcrypt-hashed (bcryptjs, $2b$), which nginx:alpine's musl
 * crypt() verifies. The plain password is never stored or logged; it exists
 * only in the request that sets it, and the page shows it once so it can be
 * sent to the client.
 *
 * One owner-only route, POST actions keyed by `action`, so every write goes
 * through the same validation.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let bcrypt = null;
try { bcrypt = require('bcryptjs'); }
catch (e) { console.warn('[client-sites] bcryptjs not loaded — writes disabled:', e.message); }

const SITES_DIR = process.env.DEMO_SITES_DIR || '/demo-sites/sites';
const AUTH_DIR = process.env.DEMO_SITES_AUTH_DIR || '/demo-sites/auth';
const PUBLIC_BASE = (process.env.DEMO_SITES_BASE_URL || 'https://sites.cbedge.net').replace(/\/+$/, '');

// Must match the slug regex in demo-sites/nginx.conf.
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const USER_RE = /^[A-Za-z0-9._-]{1,64}$/;
const MAX_HTML_BYTES = 20 * 1024 * 1024;
const BCRYPT_COST = 10;

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

function checkSlug(slug) {
  const s = String(slug || '').trim().toLowerCase();
  if (!SLUG_RE.test(s)) throw httpError(400, 'Site name: lowercase letters, numbers and dashes only (max 40), starting with a letter or number.');
  return s;
}
function checkUser(u) {
  const s = String(u || '').trim();
  if (!USER_RE.test(s)) throw httpError(400, 'Username: letters, numbers, dot, dash or underscore only (max 64).');
  return s;
}
function checkPassword(p) {
  const s = String(p == null ? '' : p);
  if (s.length < 8) throw httpError(400, 'Password must be at least 8 characters.');
  if (s.length > 72) throw httpError(400, 'Password must be 72 characters or fewer.');
  if (/[\r\n:]/.test(s)) throw httpError(400, 'Password cannot contain line breaks or ":".');
  return s;
}
function checkLabel(l, fallback) {
  const s = String(l == null ? '' : l).replace(/\s+/g, ' ').trim().slice(0, 80);
  return s || fallback;
}

const htpasswdPath = (slug) => path.join(AUTH_DIR, `${slug}.htpasswd`);
const metaPath = (slug) => path.join(AUTH_DIR, `${slug}.json`);
const siteDir = (slug) => path.join(SITES_DIR, slug);

/** Write via temp file + rename so nginx never reads a half-written file. */
async function atomicWrite(file, data) {
  const tmp = `${file}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  await fs.promises.writeFile(tmp, data, { mode: 0o644 });
  await fs.promises.chmod(tmp, 0o644); // readable by the nginx worker user
  await fs.promises.rename(tmp, file);
}

async function exists(p) {
  try { await fs.promises.access(p); return true; } catch { return false; }
}

async function readUsers(slug) {
  let raw = '';
  try { raw = await fs.promises.readFile(htpasswdPath(slug), 'utf8'); }
  catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  const out = [];
  for (const line of raw.split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i > 0) out.push({ user: line.slice(0, i), hash: line.slice(i + 1) });
  }
  return out;
}
async function writeUsers(slug, users) {
  const body = users.map((u) => `${u.user}:${u.hash}`).join('\n') + (users.length ? '\n' : '');
  await atomicWrite(htpasswdPath(slug), body);
}

async function readMeta(slug) {
  try { return JSON.parse(await fs.promises.readFile(metaPath(slug), 'utf8')); }
  catch { return {}; }
}
async function writeMeta(slug, meta) {
  await atomicWrite(metaPath(slug), JSON.stringify(meta, null, 2) + '\n');
}

async function describeSite(slug) {
  const [users, meta] = await Promise.all([readUsers(slug), readMeta(slug)]);
  let index = null;
  try {
    const st = await fs.promises.stat(path.join(siteDir(slug), 'index.html'));
    index = { bytes: st.size, mtime: st.mtimeMs };
  } catch { /* no page uploaded yet */ }
  return {
    slug,
    label: meta.label || slug,
    url: `${PUBLIC_BASE}/${slug}/`,
    users: (users || []).map((u) => u.user),
    // A folder with no htpasswd file is served as a 404 by nginx (fail closed).
    hasLoginFile: users != null,
    index,
    createdAt: meta.createdAt || null,
    updatedAt: meta.updatedAt || null,
  };
}

async function listSites() {
  const slugs = new Set();
  for (const name of await fs.promises.readdir(AUTH_DIR).catch(() => [])) {
    const m = /^(.+)\.htpasswd$/.exec(name);
    if (m && SLUG_RE.test(m[1])) slugs.add(m[1]);
  }
  for (const ent of await fs.promises.readdir(SITES_DIR, { withFileTypes: true }).catch(() => [])) {
    if (ent.isDirectory() && SLUG_RE.test(ent.name)) slugs.add(ent.name);
  }
  const sites = await Promise.all([...slugs].sort().map(describeSite));
  return sites;
}

async function touchMeta(slug, patch) {
  const now = new Date().toISOString();
  const meta = await readMeta(slug);
  await writeMeta(slug, { ...meta, createdAt: meta.createdAt || now, ...patch, updatedAt: now });
}

async function setUser(slug, username, password) {
  if (!bcrypt) throw httpError(503, 'bcryptjs is not installed on the server.');
  const users = (await readUsers(slug)) || [];
  const hash = bcrypt.hashSync(password, BCRYPT_COST);
  const i = users.findIndex((u) => u.user === username);
  if (i >= 0) users[i] = { user: username, hash };
  else users.push({ user: username, hash });
  await writeUsers(slug, users);
  return i >= 0 ? 'updated' : 'added';
}

async function writeIndex(slug, html) {
  const text = String(html || '');
  const bytes = Buffer.byteLength(text, 'utf8');
  if (!bytes) throw httpError(400, 'The HTML file is empty.');
  if (bytes > MAX_HTML_BYTES) throw httpError(413, 'The HTML file is over 20 MB.');
  if (!/<html[\s>]|<!doctype html/i.test(text.slice(0, 5000))) {
    throw httpError(400, 'That does not look like an HTML page (no <html> or <!DOCTYPE html> near the top).');
  }
  await fs.promises.mkdir(siteDir(slug), { recursive: true, mode: 0o755 });
  await atomicWrite(path.join(siteDir(slug), 'index.html'), text);
}

async function handleAction(body) {
  const action = String(body.action || '');
  switch (action) {
    case 'create': {
      const slug = checkSlug(body.slug);
      const username = checkUser(body.username || slug);
      const password = checkPassword(body.password);
      if (await exists(htpasswdPath(slug)) || await exists(siteDir(slug))) {
        throw httpError(409, `A site called "${slug}" already exists.`);
      }
      if (body.html) await writeIndex(slug, body.html);
      await setUser(slug, username, password);
      await touchMeta(slug, { label: checkLabel(body.label, slug) });
      return { site: await describeSite(slug), message: `Created ${slug}.` };
    }
    case 'set-user': {
      const slug = checkSlug(body.slug);
      if (!(await exists(htpasswdPath(slug)))) throw httpError(404, `No site called "${slug}".`);
      const username = checkUser(body.username);
      const password = checkPassword(body.password);
      const what = await setUser(slug, username, password);
      await touchMeta(slug, {});
      return { site: await describeSite(slug), message: what === 'updated' ? `Password changed for ${username}.` : `Added ${username}.` };
    }
    case 'remove-user': {
      const slug = checkSlug(body.slug);
      const username = checkUser(body.username);
      const users = await readUsers(slug);
      if (!users) throw httpError(404, `No site called "${slug}".`);
      const next = users.filter((u) => u.user !== username);
      if (next.length === users.length) throw httpError(404, `No login called "${username}".`);
      await writeUsers(slug, next);
      await touchMeta(slug, {});
      return { site: await describeSite(slug), message: `Removed ${username}.` };
    }
    case 'upload': {
      const slug = checkSlug(body.slug);
      if (!(await exists(htpasswdPath(slug)))) throw httpError(404, `No site called "${slug}".`);
      await writeIndex(slug, body.html);
      await touchMeta(slug, {});
      return { site: await describeSite(slug), message: 'Page uploaded — live now.' };
    }
    case 'rename': {
      const slug = checkSlug(body.slug);
      if (!(await exists(htpasswdPath(slug)))) throw httpError(404, `No site called "${slug}".`);
      await touchMeta(slug, { label: checkLabel(body.label, slug) });
      return { site: await describeSite(slug), message: 'Name saved.' };
    }
    case 'delete-site': {
      const slug = checkSlug(body.slug);
      if (String(body.confirm || '') !== slug) throw httpError(400, `Type "${slug}" to confirm.`);
      // htpasswd first: the moment it is gone nginx 404s the whole site, so a
      // failure partway through can never leave pages served without a login.
      await fs.promises.rm(htpasswdPath(slug), { force: true });
      await fs.promises.rm(siteDir(slug), { recursive: true, force: true });
      await fs.promises.rm(metaPath(slug), { force: true });
      return { deleted: slug, message: `Deleted ${slug}.` };
    }
    default:
      throw httpError(400, `Unknown action "${action}".`);
  }
}

/**
 * Registers /api/client-sites on the api-router.
 * @param {(path: string, def: object) => void} register
 * @param {{ send: Function, readJson: Function, NO_STORE: string }} h
 */
function registerClientSites(register, h) {
  register('/api/client-sites', {
    auth: 'owner', methods: ['GET', 'POST'],
    async handler(req, res) {
      const configured = (await exists(SITES_DIR)) && (await exists(AUTH_DIR));
      if (!configured) {
        h.send(res, 200, {
          ok: false, configured: false, baseUrl: PUBLIC_BASE, sites: [],
          error: `Folders not mounted in the dashboard container (${SITES_DIR}, ${AUTH_DIR}). See the demo-sites note in docker-compose.yml.`,
        }, { 'Cache-Control': h.NO_STORE });
        return;
      }
      try {
        if (req.method === 'GET') {
          h.send(res, 200, { ok: true, configured: true, baseUrl: PUBLIC_BASE, sites: await listSites() }, { 'Cache-Control': h.NO_STORE });
          return;
        }
        let body;
        try { body = await h.readJson(req, 30 * 1024 * 1024); }
        catch (e) { throw httpError(/too large/.test(String(e && e.message)) ? 413 : 400, 'Could not read the request (too large or not JSON).'); }
        const result = await handleAction(body || {});
        h.send(res, 200, { ok: true, ...result, sites: await listSites() }, { 'Cache-Control': h.NO_STORE });
      } catch (e) {
        const status = e && e.status ? e.status : 500;
        if (status === 500) console.error('[client-sites]', e);
        h.send(res, status, { ok: false, error: status === 500 ? `Server error: ${e && e.message}` : e.message }, { 'Cache-Control': h.NO_STORE });
      }
    },
  });
}

module.exports = { registerClientSites, _test: { handleAction, listSites, SLUG_RE } };
