import { readFile, writeFile, rename, mkdir } from "fs/promises";
import path from "path";

// Durable "deleted template" list for the owner Email Broadcast page.
//
// WHY THIS EXISTS: the templates in buildTemplates() are compiled TS modules
// under lib/emails/ - they are COPIED INTO THE DOCKER IMAGE at build time
// (Dockerfile `COPY . .`) and the repo is NOT bind-mounted at runtime
// (docker-compose mounts only ./state). A "delete" button therefore cannot
// remove the source file: any such write would land in the container's
// throwaway writable layer and come back on the next
// `docker compose up --build`. So a delete is a HIDE, recorded in ./state,
// which IS bind-mounted and outlives redeploys. The .ts modules stay the
// single source of truth and are never mutated by the web app.
//
// Mirrors lib/whatsNewHidden.ts deliberately - same storage dir, same
// temp-file + rename write, same "missing file is normal" read.
const STATE_DIR =
  process.env.EMAIL_TEMPLATES_STATE_DIR ||
  process.env.WHATS_NEW_STATE_DIR ||
  path.join(process.cwd(), "state");
const HIDDEN_PATH = path.join(STATE_DIR, "email-templates-hidden.json");

export type HiddenTemplate = { id: string; hiddenAt: string };

export async function readHiddenTemplates(): Promise<HiddenTemplate[]> {
  try {
    const raw = await readFile(HIDDEN_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e: any): e is HiddenTemplate => !!e && typeof e.id === "string" && e.id.trim() !== ""
    );
  } catch (err: any) {
    // Missing file is the normal first-run state, not an error.
    if (err?.code !== "ENOENT") {
      console.error(
        "[email-templates] hidden list unreadable at",
        HIDDEN_PATH,
        "- treating as empty",
        err
      );
    }
    return [];
  }
}

// Write via temp file + rename so a crash mid-write can never leave a
// truncated JSON file that would silently un-delete every template.
async function writeHiddenTemplates(entries: HiddenTemplate[]): Promise<void> {
  await mkdir(STATE_DIR, { recursive: true });
  const tmp = `${HIDDEN_PATH}.tmp`;
  await writeFile(tmp, JSON.stringify(entries, null, 2), "utf8");
  await rename(tmp, HIDDEN_PATH);
}

export async function hiddenTemplateIdSet(): Promise<Set<string>> {
  return new Set((await readHiddenTemplates()).map((e) => e.id));
}

// Idempotent: hiding an already-hidden id keeps the original hiddenAt.
export async function hideTemplate(id: string): Promise<HiddenTemplate[]> {
  const current = await readHiddenTemplates();
  if (current.some((e) => e.id === id)) return current;
  const next = [...current, { id, hiddenAt: new Date().toISOString() }];
  await writeHiddenTemplates(next);
  return next;
}

// Idempotent: restoring a template that was never hidden is a no-op.
export async function restoreTemplate(id: string): Promise<HiddenTemplate[]> {
  const current = await readHiddenTemplates();
  const next = current.filter((e) => e.id !== id);
  if (next.length !== current.length) await writeHiddenTemplates(next);
  return next;
}
