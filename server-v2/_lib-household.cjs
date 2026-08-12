'use strict';
/**
 * server-v2/_lib-household.cjs — auth + storage for budget.cbedge.net.
 *
 * WHY THIS IS SEPARATE FROM CB EDGE AUTH
 *   budget.cbedge.net is the household life-OS. It must NOT share an identity
 *   with cbedge.net: a CB Edge customer session grants nothing here, and the
 *   household cookie can never be sent to the main site. That is enforced two
 *   ways:
 *     1. Different cookie NAME (hh_session, not cbe_session).
 *     2. The Set-Cookie carries NO Domain attribute, so the browser scopes it
 *        host-only to budget.cbedge.net. Never add `Domain=.cbedge.net` here —
 *        that would leak the household session to every subdomain including
 *        the customer app.
 *   The owner gate (OWNER_USER_ID / users.is_owner) is untouched. /owner/budget
 *   on cbedge.net keeps working exactly as before.
 *
 * TABLES
 *   Self-bootstrapping via CREATE TABLE IF NOT EXISTS on first use — the same
 *   pattern api-router.js uses for day_posts and cb-contract-track uses for its
 *   own tables. No migration runner, nothing to remember on deploy.
 *
 * BUDGET DATA
 *   NOT duplicated. app/api/budget already scopes every row by profile_id via
 *   getOrCreateBudgetProfile(key) — the single existing profile is keyed
 *   'owner'. A household user carries budget_profile_key; both users defaulting
 *   to 'owner' means they share the existing register with zero migration.
 *   Point one at another key later and that person gets a private budget.
 *
 * PASSWORDS
 *   scrypt from node:crypto. No new dependency, no native build step.
 *   Stored as  scrypt$<N>$<r>$<p>$<saltB64>$<hashB64>.
 *
 * SESSIONS
 *   The cookie holds a 32-byte random token. The DB stores only its SHA-256, so
 *   a database dump does not hand anyone a live session.
 *
 * QUICK SIGN-IN (4-DIGIT PIN)
 *   A 4-digit PIN is 10,000 guesses — worthless on its own. It is safe here
 *   because it is only ever HALF of the credential:
 *
 *     secret 1  the DEVICE TOKEN — 32 random bytes in a second HttpOnly cookie
 *               (hh_device, host-only, 400 days) issued when the PIN is set. It
 *               never leaves the browser it was issued to, so the same PIN
 *               typed anywhere else authenticates nothing at all.
 *     secret 2  the PIN, stored scrypt-hashed against that device's row.
 *
 *   Five wrong PINs DELETES the device row — not a timed lockout. The phone
 *   falls back to email + password, which is the strong credential and the only
 *   way to re-arm quick sign-in. An attacker holding an unlocked phone therefore
 *   gets five guesses out of 10,000, once, ever.
 *
 *   The device cookie deliberately outlives the session and SURVIVES SIGN-OUT —
 *   signing out is the thing quick sign-in exists to recover from. Only "forget
 *   this device" or five bad guesses clear it.
 */

const crypto = require('crypto');

let libDb = null;
try { libDb = require('./_lib-db.cjs'); }
catch (e) { console.warn('[household] _lib-db.cjs not loaded — household routes disabled:', e.message); }

const COOKIE_NAME = 'hh_session';
const SESSION_DAYS = 30;
const SESSION_MS = SESSION_DAYS * 24 * 60 * 60 * 1000;
// Re-issue the cookie when the session is more than a day old (sliding window)
// so a daily user is never logged out, but an abandoned session still expires.
const SLIDE_AFTER_MS = 24 * 60 * 60 * 1000;

const MAX_FAILS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

// Quick sign-in. 400 days because that is the hard ceiling Chrome clamps any
// cookie to — asking for more just gets silently truncated.
const DEVICE_COOKIE = 'hh_device';
const DEVICE_DAYS = 400;
// Wrong PINs before the device is forgotten entirely. Not a timed lockout: with
// only 10,000 possible PINs, "try again in 15 minutes" is an invitation.
const MAX_PIN_FAILS = 5;

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

let ready = null;
async function ensureSchema() {
  if (!libDb) throw new Error('household: no database');
  if (ready) return ready;
  ready = (async () => {
    const pool = libDb.getPool();
    await pool.query(`
      CREATE TABLE IF NOT EXISTS hh_users (
        id                   SERIAL PRIMARY KEY,
        email                TEXT NOT NULL UNIQUE,
        password_hash        TEXT NOT NULL,
        display_name         TEXT NOT NULL,
        budget_profile_key   TEXT NOT NULL DEFAULT 'owner',
        tz                   TEXT NOT NULL DEFAULT 'America/New_York',
        must_change_password BOOLEAN NOT NULL DEFAULT TRUE,
        active               BOOLEAN NOT NULL DEFAULT TRUE,
        created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_login_at        TIMESTAMPTZ
      )`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS hh_sessions (
        token_hash TEXT PRIMARY KEY,
        user_id    INTEGER NOT NULL REFERENCES hh_users(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        expires_at TIMESTAMPTZ NOT NULL,
        user_agent TEXT,
        ip         TEXT
      )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS hh_sessions_user_idx ON hh_sessions(user_id)`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS hh_login_attempts (
        id    SERIAL PRIMARY KEY,
        email TEXT NOT NULL,
        ip    TEXT,
        ok    BOOLEAN NOT NULL,
        at    TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS hh_login_attempts_email_at_idx ON hh_login_attempts(email, at DESC)`);

    // ── Quick sign-in ────────────────────────────────────────────────────
    // One row per (browser, person). The PRIMARY KEY is the SHA-256 of the
    // device token, never the token itself — same reasoning as hh_sessions: a
    // database dump must not hand anyone half of a working credential.
    //
    // `fails` is per-DEVICE, not per-account, and it is never reset by time —
    // only by a correct PIN. Deleting the row at MAX_PIN_FAILS is the lockout.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS hh_device_pins (
        device_hash  TEXT PRIMARY KEY,
        user_id      INTEGER NOT NULL REFERENCES hh_users(id) ON DELETE CASCADE,
        pin_hash     TEXT NOT NULL,
        fails        INTEGER NOT NULL DEFAULT 0,
        user_agent   TEXT,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_used_at TIMESTAMPTZ
      )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS hh_device_pins_user_idx ON hh_device_pins(user_id)`);

    // ── Life-OS tables (phase 1 uses tasks + notes; created now so step 4 is
    //    routes and UI only) ─────────────────────────────────────────────────
    // owner_id + visibility is THE per-person / opt-in-sharing pattern:
    //   read : owner_id = :me OR visibility = 'shared'
    //   write: owner_id = :me OR visibility = 'shared'
    // 'private' means only its owner sees it. 'shared' means both of you can
    // see AND edit it — a shared list only one person can change is useless.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS hh_tasks (
        id         SERIAL PRIMARY KEY,
        owner_id   INTEGER NOT NULL REFERENCES hh_users(id) ON DELETE CASCADE,
        visibility TEXT NOT NULL DEFAULT 'private',
        title      TEXT NOT NULL,
        notes      TEXT,
        due_date   DATE,
        starred    BOOLEAN NOT NULL DEFAULT FALSE,
        project    TEXT,
        done_at    TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        touched_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS hh_tasks_open_idx ON hh_tasks(owner_id, done_at, due_date)`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS hh_notes (
        id              SERIAL PRIMARY KEY,
        owner_id        INTEGER NOT NULL REFERENCES hh_users(id) ON DELETE CASCADE,
        visibility      TEXT NOT NULL DEFAULT 'private',
        kind            TEXT NOT NULL DEFAULT 'note',
        body            TEXT NOT NULL,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_surfaced_at TIMESTAMPTZ
      )`);
    // ── Routines & habits ────────────────────────────────────────────────
    // A routine is a recurring intention, not a task: it never "completes", it
    // just gets done again tomorrow. So the item and the daily tick are
    // separate tables — one row per routine, one row per (routine, day).
    await pool.query(`
      CREATE TABLE IF NOT EXISTS hh_routines (
        id         SERIAL PRIMARY KEY,
        owner_id   INTEGER NOT NULL REFERENCES hh_users(id) ON DELETE CASCADE,
        visibility TEXT NOT NULL DEFAULT 'private',
        title      TEXT NOT NULL,
        block      TEXT NOT NULL DEFAULT 'morning',
        sort_order INTEGER NOT NULL DEFAULT 0,
        active     BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
    // PRIMARY KEY (routine_id, day) is what makes ticking idempotent: a double
    // tap on a slow connection can't log the same day twice, and a shared
    // routine ticked by one person is simply done for the household.
    // `day` is a DATE in the user's timezone, resolved before it gets here —
    // never now()::date, which would roll over at 8pm Eastern.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS hh_routine_log (
        routine_id INTEGER NOT NULL REFERENCES hh_routines(id) ON DELETE CASCADE,
        day        DATE NOT NULL,
        done_by    INTEGER REFERENCES hh_users(id) ON DELETE SET NULL,
        done_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (routine_id, day)
      )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS hh_routine_log_day_idx ON hh_routine_log(day DESC)`);

    // Urgent is separate from `starred`. Starred means "one of my Top 3 today";
    // urgent means "this can't wait". Overloading one flag would make pinning
    // something to Today silently mark it as an emergency.
    await pool.query(`ALTER TABLE hh_tasks ADD COLUMN IF NOT EXISTS urgent BOOLEAN NOT NULL DEFAULT FALSE`);

    // ── Lists: meals by day, and the grocery list they feed ──────────────
    // A meal is planned for a DAY. Its ingredients are ordinary list items that
    // carry meal_id, so the same row can be ticked off in the shop and still
    // show under Tuesday on the week board — one record, two views.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS hh_meals (
        id         SERIAL PRIMARY KEY,
        owner_id   INTEGER NOT NULL REFERENCES hh_users(id) ON DELETE CASCADE,
        visibility TEXT NOT NULL DEFAULT 'shared',
        day        DATE NOT NULL,
        title      TEXT NOT NULL,
        notes      TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS hh_meals_day_idx ON hh_meals(day)`);
    // ON DELETE SET NULL, not CASCADE: deleting "Taco night" must not silently
    // remove the tortillas from your grocery list — you may still want them.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS hh_list_items (
        id         SERIAL PRIMARY KEY,
        owner_id   INTEGER NOT NULL REFERENCES hh_users(id) ON DELETE CASCADE,
        visibility TEXT NOT NULL DEFAULT 'shared',
        list       TEXT NOT NULL DEFAULT 'grocery',
        text       TEXT NOT NULL,
        qty        TEXT,
        aisle      TEXT NOT NULL DEFAULT 'other',
        meal_id    INTEGER REFERENCES hh_meals(id) ON DELETE SET NULL,
        checked_at TIMESTAMPTZ,
        checked_by INTEGER REFERENCES hh_users(id) ON DELETE SET NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS hh_list_items_list_idx ON hh_list_items(list, checked_at)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS hh_list_items_meal_idx ON hh_list_items(meal_id)`);

    // ── Recipes ──────────────────────────────────────────────────────────
    // The cookbook behind recipe.cbedge.net. See _lib-household-recipes.cjs.
    //
    // Ingredients and steps are JSONB ON THE RECIPE ROW, not child tables.
    // That is a deliberate call: an ingredient has no life of its own — it is
    // never queried, sorted or joined outside the recipe it belongs to, and it
    // is always written as a complete replacement when you edit the recipe.
    // Child tables would buy ordering columns, a delete-and-reinsert dance on
    // every save, and three round trips to render one screen, in exchange for
    // nothing this app does. Search still reaches inside via ingredients::text.
    //
    // Each ingredient is { raw, qty, unit, item, aisle }: the line as written
    // (what you read while cooking), plus the parsed pieces (what makes
    // "cooking for 8" and the grocery hand-off possible). See parseIngredient.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS hh_recipes (
        id            SERIAL PRIMARY KEY,
        owner_id      INTEGER NOT NULL REFERENCES hh_users(id) ON DELETE CASCADE,
        visibility    TEXT NOT NULL DEFAULT 'shared',
        title         TEXT NOT NULL,
        description   TEXT,
        image_url     TEXT,
        source_url    TEXT,
        source_name   TEXT,
        servings      INTEGER,
        prep_minutes  INTEGER,
        cook_minutes  INTEGER,
        calories      INTEGER,
        category      TEXT NOT NULL DEFAULT 'other',
        skill         TEXT NOT NULL DEFAULT 'easy',
        favorite      BOOLEAN NOT NULL DEFAULT FALSE,
        notes         TEXT,
        ingredients   JSONB NOT NULL DEFAULT '[]'::jsonb,
        steps         JSONB NOT NULL DEFAULT '[]'::jsonb,
        cooked_count  INTEGER NOT NULL DEFAULT 0,
        last_cooked_at TIMESTAMPTZ,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS hh_recipes_cat_idx ON hh_recipes(category, updated_at DESC)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS hh_recipes_fav_idx ON hh_recipes(favorite, updated_at DESC)`);

    // Sorting and filtering columns. ALTER rather than part of CREATE TABLE
    // above, because hh_recipes already exists on the live box and
    // CREATE TABLE IF NOT EXISTS would skip a new column silently.
    //
    // main_ingredient is STORED, not derived per query: deriving it means
    // unpacking a JSONB array for every row of the index screen, and you cannot
    // ORDER BY it without doing that twice. Written on create and recomputed on
    // any edit to the title or the ingredients — see guessMainIngredient.
    await pool.query(`ALTER TABLE hh_recipes ADD COLUMN IF NOT EXISTS main_ingredient TEXT`);
    // Set by bulk import, cleared when you review the recipe. Bulk saves first
    // and flags second on purpose — see the policy note in the recipes lib.
    await pool.query(`ALTER TABLE hh_recipes ADD COLUMN IF NOT EXISTS needs_review BOOLEAN NOT NULL DEFAULT FALSE`);
    await pool.query(`CREATE INDEX IF NOT EXISTS hh_recipes_main_idx ON hh_recipes(main_ingredient)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS hh_recipes_review_idx ON hh_recipes(needs_review) WHERE needs_review`);
    await pool.query(`CREATE INDEX IF NOT EXISTS hh_recipes_title_idx ON hh_recipes(lower(title))`);

    // "Is this the same video?" — NOT the raw source_url. TikTok's data export
    // writes tiktokv.com/share/video/<id>, the share sheet writes a vm.tiktok.com
    // code, and the site itself writes tiktok.com/@handle/video/<id>. All three
    // are one recipe, so the key normalises to `tiktok:<id>`. See sourceKey().
    // Deliberately NOT unique: a duplicate is skipped in code with a message,
    // not rejected by a constraint that would fail the whole import row.
    await pool.query(`ALTER TABLE hh_recipes ADD COLUMN IF NOT EXISTS source_key TEXT`);

    // "Full recipe in bio". Two habits, opposite handling — see the block of
    // that name in _lib-household-recipes.cjs.
    //
    // recipe_url: where the full write-up lives, when the caption linked it and
    // we followed. source_url stays the VIDEO — it is what you saved, what you
    // want to watch, and what source_key is derived from, so swapping in the
    // blog URL would make an export list re-import every one of these.
    await pool.query(`ALTER TABLE hh_recipes ADD COLUMN IF NOT EXISTS recipe_url TEXT`);
    // partial: the caption said the real recipe is elsewhere and there was no
    // link to follow. Imported anyway, but flagged — half a recipe you don't
    // know is half is worse than none, because you find out at step four.
    await pool.query(`ALTER TABLE hh_recipes ADD COLUMN IF NOT EXISTS partial BOOLEAN NOT NULL DEFAULT FALSE`);
    await pool.query(`ALTER TABLE hh_recipes ADD COLUMN IF NOT EXISTS partial_note TEXT`);
    await pool.query(`CREATE INDEX IF NOT EXISTS hh_recipes_source_key_idx ON hh_recipes(source_key)`);

    // ── Bulk import jobs ─────────────────────────────────────────────────
    // Thirty TikTok links is thirty page fetches and thirty Claude calls —
    // minutes of work, which cannot be one HTTP request. So it is a job, and it
    // lives in REAL ROWS rather than in memory: the progress list then survives
    // a container restart, and a batch that was mid-flight when the process died
    // can be resumed instead of silently vanishing.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS hh_recipe_import_jobs (
        id          SERIAL PRIMARY KEY,
        owner_id    INTEGER NOT NULL REFERENCES hh_users(id) ON DELETE CASCADE,
        total       INTEGER NOT NULL DEFAULT 0,
        done        INTEGER NOT NULL DEFAULT 0,
        ok          INTEGER NOT NULL DEFAULT 0,
        failed      INTEGER NOT NULL DEFAULT 0,
        skipped     INTEGER NOT NULL DEFAULT 0,
        -- Links the caption gate rejected before any AI call. Counted apart
        -- from failed, because it is the gate working, not the import breaking.
        notrecipe   INTEGER NOT NULL DEFAULT 0,
        -- 'running' | 'done' | 'cancelled'
        status      TEXT NOT NULL DEFAULT 'running',
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        finished_at TIMESTAMPTZ
      )`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS hh_recipe_import_items (
        id         SERIAL PRIMARY KEY,
        job_id     INTEGER NOT NULL REFERENCES hh_recipe_import_jobs(id) ON DELETE CASCADE,
        url        TEXT NOT NULL,
        -- 'pending' | 'importing' | 'saved' | 'failed'
        status     TEXT NOT NULL DEFAULT 'pending',
        -- SET NULL, not CASCADE: deleting a bad import must not rewrite the
        -- history of the batch it came from.
        recipe_id  INTEGER REFERENCES hh_recipes(id) ON DELETE SET NULL,
        title      TEXT,
        via        TEXT,
        error      TEXT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS hh_recipe_import_items_job_idx ON hh_recipe_import_items(job_id, status)`);
    // ALTER as well as the CREATE above: the jobs table shipped this morning
    // without `skipped`, so an existing deployment needs the column added.
    await pool.query(`ALTER TABLE hh_recipe_import_jobs ADD COLUMN IF NOT EXISTS skipped INTEGER NOT NULL DEFAULT 0`);
    await pool.query(`ALTER TABLE hh_recipe_import_jobs ADD COLUMN IF NOT EXISTS notrecipe INTEGER NOT NULL DEFAULT 0`);

    // Backlinks. ON DELETE SET NULL throughout, matching hh_list_items.meal_id:
    // deleting a recipe must not silently pull tortillas off a grocery list you
    // are standing in the shop holding, or blank out Tuesday on the week board.
    // Added as ALTER on purpose — both tables predate this feature, so CREATE
    // TABLE IF NOT EXISTS above would skip the new column on the live box.
    await pool.query(`ALTER TABLE hh_list_items ADD COLUMN IF NOT EXISTS recipe_id INTEGER REFERENCES hh_recipes(id) ON DELETE SET NULL`);
    await pool.query(`ALTER TABLE hh_meals ADD COLUMN IF NOT EXISTS recipe_id INTEGER REFERENCES hh_recipes(id) ON DELETE SET NULL`);
    await pool.query(`CREATE INDEX IF NOT EXISTS hh_list_items_recipe_idx ON hh_list_items(recipe_id)`);

    // Recipe photos, as bytes.
    //
    // We COPY the image instead of keeping the source URL because a TikTok or
    // Instagram cover is a signed CDN link with an expiry in the query string:
    // it works at import and 403s a day later, so a cookbook built on remote
    // links decays into a wall of placeholder tiles.
    //
    // A SEPARATE TABLE, not a column on hh_recipes, and this is the important
    // part: nothing can drag image bytes into a list query by accident. The
    // cookbook index selects twenty rows to draw 64px thumbnails — if `bytes`
    // sat on that row it would be a multi-megabyte response every time.
    //
    // PRIMARY KEY on recipe_id (not a serial) gives one photo per recipe and
    // makes the upsert in putImage a plain ON CONFLICT. CASCADE, unlike the
    // recipe_id backlinks above: an orphaned blob helps nobody.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS hh_recipe_images (
        recipe_id  INTEGER PRIMARY KEY REFERENCES hh_recipes(id) ON DELETE CASCADE,
        mime       TEXT NOT NULL,
        bytes      BYTEA NOT NULL,
        -- Content hash. The client puts it in the img URL as ?v=, which is what
        -- makes the year-long immutable cache header safe: replace the photo and
        -- the URL changes, so every phone refetches instead of showing a cached
        -- copy of the old one until next year.
        etag       TEXT NOT NULL,
        source_url TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);

    // ── Projects ─────────────────────────────────────────────────────────
    // A project groups work and shows how far along it is. Progress is computed
    // from MILESTONES, not from tasks: a project with 40 small tasks and 3 real
    // milestones reads as 80% done when you've knocked out the easy tasks, which
    // is the exact lie a progress bar exists to prevent.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS hh_projects (
        id          SERIAL PRIMARY KEY,
        owner_id    INTEGER NOT NULL REFERENCES hh_users(id) ON DELETE CASCADE,
        visibility  TEXT NOT NULL DEFAULT 'private',
        name        TEXT NOT NULL,
        description TEXT,
        status      TEXT NOT NULL DEFAULT 'active',
        color       TEXT,
        target_date DATE,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        archived_at TIMESTAMPTZ
      )`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS hh_milestones (
        id         SERIAL PRIMARY KEY,
        project_id INTEGER NOT NULL REFERENCES hh_projects(id) ON DELETE CASCADE,
        title      TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        done_at    TIMESTAMPTZ,
        done_by    INTEGER REFERENCES hh_users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS hh_milestones_project_idx ON hh_milestones(project_id, sort_order)`);
    // Time logging. Stored in whole minutes — a stopwatch is more precision than
    // anyone reviews, and minutes keep every total exact in integer arithmetic.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS hh_time_log (
        id         SERIAL PRIMARY KEY,
        project_id INTEGER NOT NULL REFERENCES hh_projects(id) ON DELETE CASCADE,
        user_id    INTEGER NOT NULL REFERENCES hh_users(id) ON DELETE CASCADE,
        day        DATE NOT NULL,
        minutes    INTEGER NOT NULL,
        note       TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS hh_time_log_project_idx ON hh_time_log(project_id, day DESC)`);
    // Tasks gain a real project link. Added as an ALTER because hh_tasks already
    // exists on the deployed box — CREATE TABLE IF NOT EXISTS would skip it.
    // The old free-text `project` column stays for anything already using it.
    await pool.query(`ALTER TABLE hh_tasks ADD COLUMN IF NOT EXISTS project_id INTEGER REFERENCES hh_projects(id) ON DELETE SET NULL`);
    await pool.query(`CREATE INDEX IF NOT EXISTS hh_tasks_project_idx ON hh_tasks(project_id)`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS hh_settings (
        user_id INTEGER NOT NULL REFERENCES hh_users(id) ON DELETE CASCADE,
        key     TEXT NOT NULL,
        value   JSONB NOT NULL,
        PRIMARY KEY (user_id, key)
      )`);
    // Google Calendar tokens live server-side only; the SPA never sees one.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS hh_google_tokens (
        user_id       INTEGER PRIMARY KEY REFERENCES hh_users(id) ON DELETE CASCADE,
        google_email  TEXT,
        refresh_token TEXT NOT NULL,
        access_token  TEXT,
        expires_at    TIMESTAMPTZ,
        scope         TEXT,
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
    // Added after the table shipped, so these are separate ALTERs rather than
    // part of the CREATE — an existing deployment already has the table and
    // CREATE TABLE IF NOT EXISTS would skip new columns silently.
    //   share_with_household — one person connects, both see the events. This
    //     is what makes a shared family calendar work without the other person
    //     doing the Google dance at all.
    //   selected_calendars   — JSON array of calendar ids to actually show.
    //     NULL means "not chosen yet" and falls back to the primary calendar;
    //     an empty array means "deliberately none".
    await pool.query(`ALTER TABLE hh_google_tokens ADD COLUMN IF NOT EXISTS share_with_household BOOLEAN NOT NULL DEFAULT FALSE`);
    await pool.query(`ALTER TABLE hh_google_tokens ADD COLUMN IF NOT EXISTS selected_calendars JSONB`);
    //   last_synced_at — when Google last actually answered for this
    //     connection. Distinct from updated_at, which moves on every silent
    //     access-token refresh and so says nothing about whether the EVENTS are
    //     current. Written by _lib-google-calendar.cjs on a successful fetch.
    await pool.query(`ALTER TABLE hh_google_tokens ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ`);

    // ── EVERYTHING IS SHARED ─────────────────────────────────────────────
    // This is a two-person household app. Per-row private/shared was a switch
    // nobody wanted to think about at capture time, and a task only one of you
    // can see is the failure mode the app exists to prevent. The column stays
    // — dropping it would mean rewriting every query's VISIBLE predicate for no
    // gain — but from here it is always 'shared':
    //
    //   * the DEFAULT is flipped, so anything inserted without a visibility is
    //     shared rather than private;
    //   * every existing private row is converted, ONCE, below.
    //
    // The UPDATE is idempotent and runs on the first schema touch per process.
    // These tables hold hundreds of rows, not millions — this is cheaper than
    // the migration runner we deliberately don't have. If a row somehow ends up
    // private again, `(owner_id = $1 OR visibility = 'shared')` in the route
    // modules still does the right thing rather than leaking it.
    for (const t of ['hh_tasks', 'hh_notes', 'hh_routines', 'hh_meals', 'hh_list_items', 'hh_projects', 'hh_recipes']) {
      try {
        await pool.query(`ALTER TABLE ${t} ALTER COLUMN visibility SET DEFAULT 'shared'`);
        await pool.query(`UPDATE ${t} SET visibility='shared' WHERE visibility <> 'shared'`);
      } catch (e) {
        // A table that doesn't exist yet on some older deployment must not take
        // the whole schema bootstrap — and the app down — with it.
        console.warn(`[household] visibility migration skipped for ${t}:`, e.message);
      }
    }
    return true;
  })().catch((e) => { ready = null; throw e; });
  return ready;
}

// ---------------------------------------------------------------------------
// Passwords
// ---------------------------------------------------------------------------

function hashPassword(plain) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(String(plain), salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

function verifyPassword(plain, stored) {
  try {
    const parts = String(stored || '').split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const [, N, r, p, saltB64, hashB64] = parts;
    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(hashB64, 'base64');
    const actual = crypto.scryptSync(String(plain), salt, expected.length, { N: Number(N), r: Number(r), p: Number(p) });
    // Constant-time — a length mismatch would make timingSafeEqual throw.
    if (actual.length !== expected.length) return false;
    return crypto.timingSafeEqual(actual, expected);
  } catch { return false; }
}

// A password policy that is actually enforceable for two people who will pick
// their own: length is the only thing that reliably buys entropy.
function passwordProblem(plain) {
  const s = String(plain || '');
  if (s.length < 10) return 'Password must be at least 10 characters.';
  if (s.length > 200) return 'Password is too long.';
  return null;
}

/**
 * A PIN is exactly four digits — no more, no less, so the pad can auto-submit
 * on the fourth tap without a confirm button.
 *
 * The two rejections below are the only ones worth making. 1111-style repeats
 * and 1234-style runs are the first guesses anyone makes and together they are
 * a meaningful slice of PINs people actually choose. Banning more than that
 * (birth years, "0000 is taken") buys nothing measurable and just makes setup
 * feel like it is arguing with you.
 */
function pinProblem(pin) {
  const s = String(pin ?? '');
  if (!/^\d{4}$/.test(s)) return 'Your PIN must be exactly 4 digits.';
  if (/^(\d)\1{3}$/.test(s)) return 'Pick a PIN that isn’t the same digit four times.';
  if ('0123456789'.includes(s) || '9876543210'.includes(s)) {
    return 'Pick a PIN that isn’t four digits in a row.';
  }
  return null;
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

const normEmail = (e) => String(e || '').trim().toLowerCase();

const PUBLIC_USER_COLS = `id, email, display_name, budget_profile_key, tz,
  must_change_password, active, created_at, last_login_at`;

async function createUser({ email, displayName, password, budgetProfileKey = 'owner', tz = 'America/New_York' }) {
  await ensureSchema();
  const problem = passwordProblem(password);
  if (problem) throw new Error(problem);
  const pool = libDb.getPool();
  const { rows } = await pool.query(
    `INSERT INTO hh_users (email, password_hash, display_name, budget_profile_key, tz)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (email) DO NOTHING
     RETURNING ${PUBLIC_USER_COLS}`,
    [normEmail(email), hashPassword(password), String(displayName || '').trim() || normEmail(email), budgetProfileKey, tz],
  );
  if (!rows[0]) throw new Error(`user already exists: ${normEmail(email)}`);
  return rows[0];
}

async function listUsers() {
  await ensureSchema();
  const { rows } = await libDb.getPool().query(
    `SELECT ${PUBLIC_USER_COLS} FROM hh_users ORDER BY id`);
  return rows;
}

async function setPassword(email, password) {
  await ensureSchema();
  const problem = passwordProblem(password);
  if (problem) throw new Error(problem);
  const { rowCount } = await libDb.getPool().query(
    `UPDATE hh_users SET password_hash=$2, must_change_password=FALSE WHERE email=$1`,
    [normEmail(email), hashPassword(password)]);
  if (!rowCount) throw new Error(`no such user: ${normEmail(email)}`);
  return true;
}

// ---------------------------------------------------------------------------
// Login throttling
// ---------------------------------------------------------------------------

async function recentFailures(email) {
  const { rows } = await libDb.getPool().query(
    `SELECT COUNT(*)::int AS n FROM hh_login_attempts
      WHERE email=$1 AND ok=FALSE AND at > now() - ($2::int * interval '1 millisecond')`,
    [normEmail(email), LOCKOUT_MS]);
  return rows[0]?.n ?? 0;
}

async function logAttempt(email, ip, ok) {
  try {
    await libDb.getPool().query(
      `INSERT INTO hh_login_attempts (email, ip, ok) VALUES ($1,$2,$3)`,
      [normEmail(email), ip || null, !!ok]);
  } catch { /* never let the audit log break a login */ }
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

function parseCookies(req) {
  const raw = req.headers?.cookie || '';
  const out = {};
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

// NOTE the deliberate absence of `Domain=`. Host-only cookie — see the header
// comment. Secure is on always: budget.cbedge.net is HTTPS via the tunnel.
function sessionCookie(token, maxAgeSec) {
  return [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    `Max-Age=${maxAgeSec}`,
  ].join('; ');
}

const clearCookie = () => `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

// The quick-sign-in device token. Same flags as the session cookie for the same
// reasons — HttpOnly so no script can read it, and NO Domain so it can never be
// sent to cbedge.net. It just lives far longer and is not a session.
function deviceCookie(token) {
  return [
    `${DEVICE_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    `Max-Age=${DEVICE_DAYS * 24 * 60 * 60}`,
  ].join('; ');
}

const clearDeviceCookie = () => `${DEVICE_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

const deviceToken = (req) => parseCookies(req)[DEVICE_COOKIE] || null;

async function createSession(userId, req) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_MS);
  await libDb.getPool().query(
    `INSERT INTO hh_sessions (token_hash, user_id, expires_at, user_agent, ip)
     VALUES ($1,$2,$3,$4,$5)`,
    [sha256(token), userId, expires,
     String(req?.headers?.['user-agent'] || '').slice(0, 300) || null, clientIp(req)]);
  return { token, expires };
}

function clientIp(req) {
  const fwd = req?.headers?.['cf-connecting-ip'] || req?.headers?.['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim().slice(0, 64);
  return String(req?.socket?.remoteAddress || '').slice(0, 64) || null;
}

/** Resolve the household user for a request, or null. Never throws. */
async function userFromRequest(req) {
  if (!libDb) return null;
  try {
    const token = parseCookies(req)[COOKIE_NAME];
    if (!token) return null;
    await ensureSchema();
    const { rows } = await libDb.getPool().query(
      `SELECT u.id, u.email, u.display_name, u.budget_profile_key, u.tz,
              u.must_change_password, u.active, s.created_at AS session_created_at
         FROM hh_sessions s JOIN hh_users u ON u.id = s.user_id
        WHERE s.token_hash = $1 AND s.expires_at > now()`,
      [sha256(token)]);
    const u = rows[0];
    if (!u || !u.active) return null;
    return u;
  } catch { return null; }
}

/** True when the cookie is old enough to be worth re-issuing (sliding window). */
function shouldSlide(user) {
  const created = user?.session_created_at ? new Date(user.session_created_at).getTime() : 0;
  return created > 0 && Date.now() - created > SLIDE_AFTER_MS;
}

async function refreshSession(req) {
  const token = parseCookies(req)[COOKIE_NAME];
  if (!token) return null;
  const expires = new Date(Date.now() + SESSION_MS);
  await libDb.getPool().query(
    `UPDATE hh_sessions SET expires_at=$2, created_at=now() WHERE token_hash=$1`,
    [sha256(token), expires]);
  return { token, expires };
}

async function destroySession(req) {
  const token = parseCookies(req)[COOKIE_NAME];
  if (!token) return;
  try {
    await libDb.getPool().query(`DELETE FROM hh_sessions WHERE token_hash=$1`, [sha256(token)]);
  } catch { /* signing out is best-effort; the cookie is cleared regardless */ }
}

async function destroyAllSessions(userId) {
  await libDb.getPool().query(`DELETE FROM hh_sessions WHERE user_id=$1`, [userId]);
}

/** Opportunistic cleanup so hh_sessions doesn't grow forever. */
async function pruneSessions() {
  try { await libDb.getPool().query(`DELETE FROM hh_sessions WHERE expires_at < now()`); }
  catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

/**
 * Returns { ok:true, user, cookie } or { ok:false, code, error }.
 * Deliberately returns the SAME message for unknown-email and wrong-password —
 * with exactly two accounts, distinguishing them tells an attacker which email
 * is real.
 */
async function login({ email, password, req }) {
  await ensureSchema();
  const e = normEmail(email);
  const ip = clientIp(req);

  if (!e || !password) return { ok: false, code: 400, error: 'Email and password are required.' };

  if (await recentFailures(e) >= MAX_FAILS) {
    await logAttempt(e, ip, false);
    return { ok: false, code: 429, error: 'Too many attempts. Try again in 15 minutes.' };
  }

  const { rows } = await libDb.getPool().query(
    `SELECT id, email, password_hash, display_name, budget_profile_key, tz,
            must_change_password, active
       FROM hh_users WHERE email=$1`, [e]);
  const u = rows[0];

  // Burn roughly the same CPU on an unknown email as on a real one so response
  // time doesn't leak which addresses exist.
  if (!u || !u.active) {
    verifyPassword(String(password), hashPassword('decoy-not-a-real-password'));
    await logAttempt(e, ip, false);
    return { ok: false, code: 401, error: 'Email or password is incorrect.' };
  }

  if (!verifyPassword(password, u.password_hash)) {
    await logAttempt(e, ip, false);
    return { ok: false, code: 401, error: 'Email or password is incorrect.' };
  }

  await logAttempt(e, ip, true);
  void pruneSessions();
  const { token } = await createSession(u.id, req);
  await libDb.getPool().query(`UPDATE hh_users SET last_login_at=now() WHERE id=$1`, [u.id]);

  delete u.password_hash;
  return { ok: true, user: u, cookie: sessionCookie(token, SESSION_DAYS * 24 * 60 * 60) };
}

/** Change your own password. Requires the current one. Kills other sessions. */
async function changePassword({ userId, currentPassword, newPassword, req }) {
  await ensureSchema();
  const problem = passwordProblem(newPassword);
  if (problem) return { ok: false, code: 400, error: problem };
  const pool = libDb.getPool();
  const { rows } = await pool.query(`SELECT password_hash FROM hh_users WHERE id=$1`, [userId]);
  if (!rows[0]) return { ok: false, code: 404, error: 'User not found.' };
  if (!verifyPassword(currentPassword, rows[0].password_hash)) {
    return { ok: false, code: 401, error: 'Current password is incorrect.' };
  }
  await pool.query(
    `UPDATE hh_users SET password_hash=$2, must_change_password=FALSE WHERE id=$1`,
    [userId, hashPassword(newPassword)]);
  // Every other device gets signed out, then this one is re-issued.
  await destroyAllSessions(userId);
  const { token } = await createSession(userId, req);
  return { ok: true, cookie: sessionCookie(token, SESSION_DAYS * 24 * 60 * 60) };
}

// ---------------------------------------------------------------------------
// Quick sign-in (4-digit PIN, bound to one device)
// ---------------------------------------------------------------------------

const uaOf = (req) => String(req?.headers?.['user-agent'] || '').slice(0, 300) || null;

/**
 * Arm (or re-arm) quick sign-in for the browser making this request.
 *
 * Requires an ALREADY-AUTHENTICATED caller — a PIN is never a way to create
 * access, only a shortcut back to access you have already proven with a
 * password. Re-issues the device cookie every time so an active phone's 400
 * days keep sliding forward.
 */
async function setPin({ userId, pin, req }) {
  await ensureSchema();
  const problem = pinProblem(pin);
  if (problem) return { ok: false, code: 400, error: problem };

  const pool = libDb.getPool();
  let token = deviceToken(req);

  // A shared laptop: if this browser's token is already claimed by the OTHER
  // person, mint a fresh one rather than overwriting their quick sign-in.
  if (token) {
    const { rows } = await pool.query(
      `SELECT user_id FROM hh_device_pins WHERE device_hash=$1`, [sha256(token)]);
    if (rows[0] && rows[0].user_id !== userId) token = null;
  }
  if (!token) token = crypto.randomBytes(32).toString('base64url');

  await pool.query(
    `INSERT INTO hh_device_pins (device_hash, user_id, pin_hash, fails, user_agent, last_used_at)
     VALUES ($1,$2,$3,0,$4,now())
     ON CONFLICT (device_hash) DO UPDATE
        SET user_id = EXCLUDED.user_id, pin_hash = EXCLUDED.pin_hash, fails = 0,
            user_agent = EXCLUDED.user_agent, last_used_at = now()`,
    [sha256(token), userId, hashPassword(pin), uaOf(req)]);

  return { ok: true, cookie: deviceCookie(token) };
}

/** Does the browser making this request have a PIN for this user? Never throws. */
async function deviceHasPin(req, userId) {
  if (!libDb) return false;
  try {
    const token = deviceToken(req);
    if (!token) return false;
    await ensureSchema();
    const { rows } = await libDb.getPool().query(
      `SELECT 1 FROM hh_device_pins WHERE device_hash=$1 AND user_id=$2`,
      [sha256(token), userId]);
    return !!rows[0];
  } catch { return false; }
}

/** How many browsers this user has armed. For the "forget everywhere" control. */
async function countPinDevices(userId) {
  try {
    await ensureSchema();
    const { rows } = await libDb.getPool().query(
      `SELECT COUNT(*)::int AS n FROM hh_device_pins WHERE user_id=$1`, [userId]);
    return rows[0]?.n ?? 0;
  } catch { return 0; }
}

/**
 * What the SIGNED-OUT login screen asks before it decides which form to draw.
 *
 * Returns the display name so the PIN screen can say "Welcome back, Heather" —
 * which is safe precisely because it takes the device cookie to get it. A
 * stranger loading budget.cbedge.net cold still learns nothing.
 */
async function pinStatus(req) {
  if (!libDb) return { hasPin: false };
  try {
    const token = deviceToken(req);
    if (!token) return { hasPin: false };
    await ensureSchema();
    const { rows } = await libDb.getPool().query(
      `SELECT d.fails, u.display_name, u.active
         FROM hh_device_pins d JOIN hh_users u ON u.id = d.user_id
        WHERE d.device_hash = $1`, [sha256(token)]);
    const r = rows[0];
    if (!r || !r.active) return { hasPin: false };
    return {
      hasPin: true,
      displayName: r.display_name,
      attemptsLeft: Math.max(0, MAX_PIN_FAILS - r.fails),
    };
  } catch { return { hasPin: false }; }
}

/**
 * Sign in with the PIN. Returns the same shape as login().
 *
 * `forget: true` on a failure means the device row is gone — the client should
 * drop to the password form and not offer the PIN pad again.
 */
async function pinLogin({ pin, req }) {
  await ensureSchema();
  const pool = libDb.getPool();
  const token = deviceToken(req);
  const gone = {
    ok: false, code: 401, forget: true,
    error: 'Quick sign-in isn’t set up on this device. Use your password.',
  };
  if (!token) return gone;

  const dh = sha256(token);
  const { rows } = await pool.query(
    `SELECT d.pin_hash, d.fails, u.id, u.email, u.display_name, u.budget_profile_key,
            u.tz, u.must_change_password, u.active
       FROM hh_device_pins d JOIN hh_users u ON u.id = d.user_id
      WHERE d.device_hash = $1`, [dh]);
  const r = rows[0];

  if (!r || !r.active) {
    await pool.query(`DELETE FROM hh_device_pins WHERE device_hash=$1`, [dh]);
    return gone;
  }

  const burn = async () => {
    await pool.query(`DELETE FROM hh_device_pins WHERE device_hash=$1`, [dh]);
    return {
      ok: false, code: 429, forget: true,
      error: 'Too many wrong PINs. Sign in with your password.',
    };
  };

  if (r.fails >= MAX_PIN_FAILS) return burn();
  if (!/^\d{4}$/.test(String(pin ?? ''))) {
    return { ok: false, code: 400, error: 'Enter your 4-digit PIN.' };
  }

  if (!verifyPassword(pin, r.pin_hash)) {
    const { rows: f } = await pool.query(
      `UPDATE hh_device_pins SET fails = fails + 1 WHERE device_hash=$1 RETURNING fails`, [dh]);
    await logAttempt(r.email, clientIp(req), false);
    const left = Math.max(0, MAX_PIN_FAILS - (f[0]?.fails ?? MAX_PIN_FAILS));
    if (left <= 0) return burn();
    return {
      ok: false, code: 401, attemptsLeft: left,
      error: `Wrong PIN. ${left} ${left === 1 ? 'try' : 'tries'} left.`,
    };
  }

  await pool.query(
    `UPDATE hh_device_pins SET fails = 0, last_used_at = now() WHERE device_hash=$1`, [dh]);
  await logAttempt(r.email, clientIp(req), true);
  void pruneSessions();
  const { token: sessionToken } = await createSession(r.id, req);
  await pool.query(`UPDATE hh_users SET last_login_at = now() WHERE id=$1`, [r.id]);

  delete r.pin_hash;
  delete r.fails;
  return {
    ok: true,
    user: r,
    cookie: sessionCookie(sessionToken, SESSION_DAYS * 24 * 60 * 60),
    // Re-issued so daily use keeps pushing the 400 days out.
    deviceCookie: deviceCookie(token),
  };
}

/** Forget quick sign-in — this browser, or every browser this user armed. */
async function removePin({ userId, req, allDevices = false }) {
  await ensureSchema();
  const pool = libDb.getPool();
  if (allDevices) {
    await pool.query(`DELETE FROM hh_device_pins WHERE user_id=$1`, [userId]);
  } else {
    const token = deviceToken(req);
    if (token) {
      await pool.query(`DELETE FROM hh_device_pins WHERE device_hash=$1 AND user_id=$2`,
        [sha256(token), userId]);
    }
  }
  // The cookie goes too. Leaving it would make the next "set a PIN" reuse a
  // token the user just asked to be rid of.
  return { ok: true, cookie: clearDeviceCookie() };
}

// ---------------------------------------------------------------------------
// Settings (per user, JSONB key/value)
// ---------------------------------------------------------------------------

const DEFAULT_SETTINGS = {
  // Days an open task can go untouched before Today flags it as "Slipping".
  // Changeable per person without a deploy.
  slippingDays: 7,
  // US ZIP for the weather tile on Today. 27591 is Wendell — home for both
  // people on this instance, so it is the DEFAULT rather than something each
  // of them has to type in. Still per-user underneath: either can override it
  // in Settings without touching the other, and clearing it to '' turns the
  // tile off for that person only.
  weatherZip: '27591',
};

async function getSettings(userId) {
  await ensureSchema();
  const { rows } = await libDb.getPool().query(
    `SELECT key, value FROM hh_settings WHERE user_id=$1`, [userId]);
  const out = { ...DEFAULT_SETTINGS };
  for (const r of rows) out[r.key] = r.value;
  return out;
}

async function setSetting(userId, key, value) {
  await ensureSchema();
  await libDb.getPool().query(
    `INSERT INTO hh_settings (user_id, key, value) VALUES ($1,$2,$3)
     ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value`,
    [userId, String(key), JSON.stringify(value)]);
  return getSettings(userId);
}

module.exports = {
  COOKIE_NAME,
  DEVICE_COOKIE,
  SESSION_DAYS,
  MAX_PIN_FAILS,
  DEFAULT_SETTINGS,
  getSettings,
  setSetting,
  /** Raw pg pool, for the route module's task/note queries. */
  pool: () => libDb.getPool(),
  ensureSchema,
  hashPassword,
  verifyPassword,
  passwordProblem,
  pinProblem,
  createUser,
  listUsers,
  setPassword,
  login,
  changePassword,
  setPin,
  pinLogin,
  pinStatus,
  removePin,
  deviceHasPin,
  countPinDevices,
  userFromRequest,
  shouldSlide,
  refreshSession,
  destroySession,
  destroyAllSessions,
  sessionCookie,
  clearCookie,
  deviceCookie,
  clearDeviceCookie,
  clientIp,
  available: () => !!libDb,
};
