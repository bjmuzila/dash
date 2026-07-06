// Password hashing for the custom auth system (replaces Supabase Auth's GoTrue).
//
// New/rotated passwords use scrypt (Node's built-in `crypto`, no dependency).
// Passwords migrated from Supabase arrive as bcrypt hashes ($2a$/$2b$/$2y$) --
// verifyPassword() detects the format and checks against bcryptjs (pure JS, no
// native compile step) so existing paying customers never have to reset their
// password. A successful bcrypt verify returns needsRehash: true so the caller
// (login route) can transparently upgrade the stored hash to scrypt.

import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "crypto";
import { promisify } from "util";
import bcrypt from "bcryptjs";

const scrypt = promisify(scryptCb);

const SCRYPT_N = 16384; // 2^14 -- ~16MB memory, comfortable server-side cost
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 64;

/** New format: scrypt$N$r$p$saltHex$hashHex */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = (await scrypt(password, salt, KEY_LEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P })) as Buffer;
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("hex")}$${derived.toString("hex")}`;
}

async function verifyScrypt(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, nStr, rStr, pStr, saltHex, hashHex] = parts;
  const N = Number(nStr), r = Number(rStr), p = Number(pStr);
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  const derived = (await scrypt(password, salt, expected.length, { N, r, p })) as Buffer;
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

function isBcryptHash(stored: string): boolean {
  return /^\$2[aby]\$/.test(stored);
}

export interface VerifyResult {
  ok: boolean;
  /** true when `stored` was a legacy bcrypt hash that verified OK -- caller
   *  should re-hash with hashPassword() and persist it (upgrade-on-login). */
  needsRehash: boolean;
}

export async function verifyPassword(password: string, stored: string | null | undefined): Promise<VerifyResult> {
  if (!stored) return { ok: false, needsRehash: false };
  if (isBcryptHash(stored)) {
    const ok = await bcrypt.compare(password, stored);
    return { ok, needsRehash: ok };
  }
  const ok = await verifyScrypt(password, stored);
  return { ok, needsRehash: false };
}
