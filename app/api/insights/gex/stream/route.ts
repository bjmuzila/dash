import { NextResponse } from "next/server";

const PROXY = process.env.PROXY_URL ?? "http://localhost:3001";
const INTERVAL_MS = 30_000;

export const dynamic = "force-dynamic";

export async function GET() {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let isClosed = false;

      async function push() {
        if (isClosed) return;

        try {
          const res = await fetch(`${PROXY}/proxy/api/tt/gex`, { cache: "no-store" });
          const json = res.ok ? await res.json() : { error: "proxy error" };
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(json)}\n\n`));
          } catch {
            isClosed = true;
          }
        } catch (e) {
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: String(e) })}\n\n`));
          } catch {
            isClosed = true;
          }
        }
      }

      // Send immediately on connect
      await push();

      const id = setInterval(push, INTERVAL_MS);

      // Clean up when client disconnects
      const handleAbort = () => {
        isClosed = true;
        clearInterval(id);
        controller.close();
      };

      (controller as unknown as { signal?: AbortSignal }).signal?.addEventListener("abort", handleAbort);
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
