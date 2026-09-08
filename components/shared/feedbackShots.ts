/**
 * feedbackShots — screenshot attachments for support tickets, browser side.
 *
 * Both ends of the ticket system (a customer at /feedback, the owner at
 * /owner/feedback) can attach images to the opening message or to any reply.
 * The wire format is a data URL inside the ordinary JSON body — `shots: [...]`
 * on POST /api/feedback and POST /api/feedback/:id/messages — because there is
 * no multipart parser in server-v2 and never needed to be one.
 *
 * That makes the browser responsible for size. A raw 4K screenshot is 6-8MB and
 * base64 inflates it by a third; downscaled to 1600px and re-encoded it is a
 * couple of hundred KB, which is the difference between a reply that sends on a
 * phone and one that times out. `prepareShot` below is the only path that
 * should ever produce a data URL for this API.
 *
 * PNG is kept for small images (a cropped screenshot of TEXT goes to mush in
 * JPEG at any bearable quality) and only large ones are re-encoded to JPEG,
 * where the size win is real and the content is a whole screen.
 *
 * MIRROR: owner-vite/src/lib/feedbackShots.ts is a copy — owner-vite has no
 * '@/components' alias and builds separately. Change one, change the other.
 */

/** An attachment as /api/feedback/:id returns it — never the bytes. */
export type FeedbackShot = {
  id: number;
  /** null = attached to the ticket's opening message. */
  message_id: number | null;
  author: "user" | "owner";
  mime: string;
  byte_len: number | string;
  etag: string;
  name: string | null;
  created_at: string;
};

/** Server caps this too; keeping the numbers here is what makes the message honest. */
export const MAX_SHOTS = 6;
/** Longest edge after downscaling. 1600 keeps UI text readable at 1:1 on a laptop. */
export const SHOT_MAX_PX = 1600;
/** Above this, re-encode to JPEG rather than shipping a multi-MB PNG. */
export const PNG_KEEP_BYTES = 400 * 1024;
export const SHOT_ACCEPT = "image/png,image/jpeg,image/webp,image/gif";

/** A picked-but-not-yet-sent image. `dataUrl` is what goes on the wire. */
export type PendingShot = {
  /** Local key only — the server assigns the real id. */
  key: string;
  name: string;
  dataUrl: string;
  bytes: number;
};

/** Where the thread pulls an attachment's bytes from. */
export const shotUrl = (s: Pick<FeedbackShot, "id" | "etag">) =>
  `/api/feedback/shot/${s.id}?v=${encodeURIComponent(s.etag)}`;

export const shotKb = (n: number | string): string => {
  const b = Number(n ?? 0);
  if (!Number.isFinite(b) || b <= 0) return "";
  return b < 1024 * 1024 ? `${Math.round(b / 1024)} KB` : `${(b / (1024 * 1024)).toFixed(1)} MB`;
};

/** Animated GIFs would lose their frames on a canvas, so they pass through whole. */
const passThrough = (file: File) => file.type === "image/gif";

const readAsDataUrl = (file: Blob) =>
  new Promise<string>((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result || ""));
    fr.onerror = () => reject(new Error("Could not read that file."));
    fr.readAsDataURL(file);
  });

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("That file isn't an image we can read."));
    img.src = src;
  });

/**
 * One picked file -> one PendingShot, downscaled.
 *
 * Rejects (throws) with a sentence meant to be shown to the person, because
 * every caller renders the message straight into the composer.
 */
export async function prepareShot(file: File): Promise<PendingShot> {
  if (!file.type.startsWith("image/")) throw new Error(`${file.name || "That file"} isn't an image.`);
  const raw = await readAsDataUrl(file);
  const key = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const name = file.name || "screenshot.png";

  if (passThrough(file)) {
    if (file.size > 5 * 1024 * 1024) throw new Error("That GIF is too big — 5MB max.");
    return { key, name, dataUrl: raw, bytes: file.size };
  }

  const img = await loadImage(raw);
  const scale = Math.min(1, SHOT_MAX_PX / Math.max(img.naturalWidth, img.naturalHeight));
  // Small PNG, no resize needed: ship the original. Re-encoding a 300KB crop of
  // a chart buys nothing and costs sharpness.
  if (scale === 1 && file.type === "image/png" && file.size <= PNG_KEEP_BYTES) {
    return { key, name, dataUrl: raw, bytes: file.size };
  }

  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Your browser wouldn't let us resize that image.");
  // Screenshots are usually dark UI; a white mat behind a transparent PNG reads
  // better than the black one a bare JPEG encode produces.
  ctx.fillStyle = "#0d1117";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);

  // 0.9 rather than the usual 0.8: this is a picture of TEXT, and ringing around
  // small glyphs is exactly what makes a bug report unreadable.
  const out = canvas.toDataURL("image/jpeg", 0.9);
  const bytes = Math.round((out.length - out.indexOf(",") - 1) * 0.75);
  if (bytes > 5 * 1024 * 1024) throw new Error("That image is too big even after resizing.");
  return { key, name, dataUrl: out, bytes };
}

/** Prepare a batch, respecting how many slots are left. Throws on the first bad one. */
export async function prepareShots(files: File[], already: number): Promise<PendingShot[]> {
  const room = MAX_SHOTS - already;
  if (room <= 0) throw new Error(`Up to ${MAX_SHOTS} images per message.`);
  const take = files.slice(0, room);
  const out: PendingShot[] = [];
  for (const f of take) out.push(await prepareShot(f));
  return out;
}

/** Image files out of a paste or a drop, or an empty array. */
export function imageFilesFrom(dt: DataTransfer | null | undefined): File[] {
  if (!dt) return [];
  const files: File[] = [];
  if (dt.files && dt.files.length) {
    for (let i = 0; i < dt.files.length; i += 1) {
      const f = dt.files[i];
      if (f && f.type.startsWith("image/")) files.push(f);
    }
  }
  // A screenshot pasted from the clipboard arrives as an item, not a file, in
  // some browsers — and with no name, hence the fallback below.
  if (!files.length && dt.items && dt.items.length) {
    for (let i = 0; i < dt.items.length; i += 1) {
      const it = dt.items[i];
      if (it.kind !== "file" || !it.type.startsWith("image/")) continue;
      const f = it.getAsFile();
      if (f) files.push(f);
    }
  }
  return files;
}
