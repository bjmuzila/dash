// One-time cleanup: delete corrupt premium_flow rows for a given date.
// Usage: node scripts/purge-premium-flow.js 2026-06-22
// Connection string comes from arg 2, or DATABASE_URL env.
const { Pool } = require("pg");

const date = process.argv[2] || "2026-06-22";
const url =
  process.argv[3] ||
  process.env.DATABASE_URL ||
  "postgresql://dash_n572_user:ctIREmpLnAI3nxhq496SK6qfqjyg9OaS@dpg-d8o64ugg4nts73d1dki0-a.virginia-postgres.render.com/dash_n572?sslmode=require";

const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

(async () => {
  try {
    const res = await pool.query("DELETE FROM premium_flow WHERE date = $1", [date]);
    console.log(`Deleted ${res.rowCount} row(s) from premium_flow for ${date}.`);
  } catch (e) {
    console.error("Failed:", e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
