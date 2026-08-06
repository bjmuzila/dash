#!/usr/bin/env node
'use strict';
/**
 * server-v2/scripts/hh-user.js — manage budget.cbedge.net accounts.
 *
 * There is no signup route on the household app by design. Accounts are made
 * here, on the box, by you.
 *
 * Run inside the dashboard container (it has DATABASE_URL and _lib-db.cjs):
 *
 *   docker compose exec dashboard node server-v2/scripts/hh-user.js list
 *   docker compose exec dashboard node server-v2/scripts/hh-user.js add <email> "<Display Name>" [password]
 *   docker compose exec dashboard node server-v2/scripts/hh-user.js passwd <email> <newPassword>
 *   docker compose exec dashboard node server-v2/scripts/hh-user.js profile <email> <budgetProfileKey>
 *   docker compose exec dashboard node server-v2/scripts/hh-user.js sessions-clear <email>
 *
 * Omit the password on `add` and a strong one is generated and printed ONCE.
 * Both accounts start with must_change_password = true.
 *
 * budgetProfileKey decides whose budget you see. Both accounts on 'owner' (the
 * default) share the existing register — that is the current single profile the
 * /owner/budget page has always used. Give someone a different key and they get
 * a private budget that starts empty.
 */

const path = require('path');
const crypto = require('crypto');

// Resolve _lib-household.cjs relative to this file so the script works from any cwd.
const hh = require(path.join(__dirname, '..', '_lib-household.cjs'));

function genPassword() {
  // 4 groups of 5 from an unambiguous alphabet — long, typable on a phone.
  const A = 'abcdefghjkmnpqrstuvwxyz23456789';
  const pick = () => A[crypto.randomBytes(1)[0] % A.length];
  return Array.from({ length: 4 }, () => Array.from({ length: 5 }, pick).join('')).join('-');
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);

  if (!hh.available()) {
    console.error('No DB layer (_lib-db.cjs). Run this inside the dashboard container.');
    process.exit(1);
  }
  await hh.ensureSchema();

  if (cmd === 'list') {
    const users = await hh.listUsers();
    if (!users.length) { console.log('(no household accounts yet)'); return; }
    for (const u of users) {
      console.log(
        `#${u.id}  ${u.email.padEnd(32)} ${String(u.display_name).padEnd(16)} ` +
        `profile=${u.budget_profile_key.padEnd(10)} tz=${u.tz} ` +
        `${u.active ? '' : '[INACTIVE] '}${u.must_change_password ? '[must-change-pw] ' : ''}` +
        `last_login=${u.last_login_at ? new Date(u.last_login_at).toISOString() : 'never'}`);
    }
    return;
  }

  if (cmd === 'add') {
    const [email, displayName, password] = args;
    if (!email || !displayName) {
      console.error('usage: hh-user.js add <email> "<Display Name>" [password]');
      process.exit(1);
    }
    const pw = password || genPassword();
    const user = await hh.createUser({ email, displayName, password: pw });
    console.log(`created #${user.id}  ${user.email}  (${user.display_name})`);
    console.log(`  budget profile : ${user.budget_profile_key}`);
    console.log(`  password       : ${pw}`);
    console.log('  ^ shown once. They should change it after the first sign-in.');
    return;
  }

  if (cmd === 'passwd') {
    const [email, password] = args;
    if (!email || !password) { console.error('usage: hh-user.js passwd <email> <newPassword>'); process.exit(1); }
    await hh.setPassword(email, password);
    console.log(`password updated for ${email}`);
    return;
  }

  if (cmd === 'profile') {
    const [email, key] = args;
    if (!email || !key) { console.error('usage: hh-user.js profile <email> <budgetProfileKey>'); process.exit(1); }
    const libDb = require(path.join(__dirname, '..', '_lib-db.cjs'));
    const { rowCount } = await libDb.getPool().query(
      `UPDATE hh_users SET budget_profile_key=$2 WHERE email=$1`,
      [String(email).trim().toLowerCase(), String(key).trim()]);
    if (!rowCount) { console.error(`no such user: ${email}`); process.exit(1); }
    console.log(`${email} now reads budget profile "${key}"`);
    return;
  }

  if (cmd === 'sessions-clear') {
    const [email] = args;
    if (!email) { console.error('usage: hh-user.js sessions-clear <email>'); process.exit(1); }
    const users = await hh.listUsers();
    const u = users.find((x) => x.email === String(email).trim().toLowerCase());
    if (!u) { console.error(`no such user: ${email}`); process.exit(1); }
    await hh.destroyAllSessions(u.id);
    console.log(`signed ${email} out of every device`);
    return;
  }

  console.error(`unknown command: ${cmd || '(none)'}
commands: list | add | passwd | profile | sessions-clear`);
  process.exit(1);
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(String(e?.message || e));
  process.exit(1);
});
