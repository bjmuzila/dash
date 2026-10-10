/**
 * Shared Discord upload transport.
 *
 * Every Discord button in the app goes through this one function. Before it
 * existed, five call sites each hand-rolled the same base64 -> Uint8Array ->
 * Blob -> FormData -> POST dance, and four of the five threw away the server's
 * error body — so a failure surfaced in the console as a bare "Discord 500"
 * with no cause. That cost an afternoon of debugging a route that was never
 * even being reached. If you add a sixth button, call this; don't re-roll it.
 *
 * Server side lives in app/api/discord-share/route.ts, which holds the webhook
 * (DISCORD_WEBHOOK_URL) so it never reaches the client.
 */

export interface ShareToDiscordOpts {
  /** Message text posted alongside the image. Optional — image-only is fine. */
  content?: string;
  /** PNG as either a data URL / raw base64 string, or an already-built Blob. */
  image?: string | Blob | null;
  /** Filename Discord shows on the attachment. */
  filename?: string;
}

/** data URL (or bare base64) -> Blob. Mirrors what every call site used to do. */
export function base64ToPngBlob(imageBase64: string): Blob {
  const base64 = imageBase64.replace(/^data:image\/\w+;base64,/, "");
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return new Blob([bytes], { type: "image/png" });
}

/**
 * POST an image (and/or message) to Discord via the server-side webhook proxy.
 *
 * Throws an Error carrying the server's actual message on failure. Read that
 * message — do not reduce it back to a status code, which is the mistake this
 * module exists to prevent.
 */
export async function shareToDiscord(opts: ShareToDiscordOpts): Promise<void> {
  const { content, image, filename = "snapshot.png" } = opts;

  const form = new FormData();
  form.append("payload_json", JSON.stringify(content ? { content } : {}));

  if (image) {
    const blob = typeof image === "string" ? base64ToPngBlob(image) : image;
    form.append("files[0]", blob, filename);
  }

  const res = await fetch("/api/discord-share", { method: "POST", body: form });
  if (res.ok) return;

  // The route returns { ok: false, error } as JSON. Surface that string: it is
  // the difference between "Discord 500" and the actual cause. Note the route
  // deliberately answers 500 rather than 502 on failure — Cloudflare replaces a
  // 502 body from the origin with its own "Bad gateway" page, which would
  // silently discard everything we try to read here.
  let detail = "";
  try {
    const text = await res.text();
    try {
      const json = JSON.parse(text);
      detail = typeof json?.error === "string" ? json.error : text;
    } catch {
      detail = text; // not JSON (proxy error page, empty body, ...)
    }
  } catch {
    /* body unreadable — fall back to the status alone */
  }

  throw new Error(
    `Discord share failed (${res.status})${detail ? `: ${detail.slice(0, 500)}` : ""}`,
  );
}
