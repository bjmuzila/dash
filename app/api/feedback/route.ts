import { NextRequest, NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import { addFeedback, listFeedback, setFeedbackStatus } from "@/lib/db";

// Customer feedback. Any signed-in user may POST a note. Reading the feed and
// resolving items is owner-only (same gate as /budget). If OWNER_USER_ID is not
// yet configured, any signed-in user is allowed so the owner isn't locked out.
const OWNER_USER_ID = (process.env.OWNER_USER_ID || "").trim();

async function ownerGate(): Promise<{ ok: true } | { ok: false; status: number }> {
  const { userId } = await auth();
  if (!userId) return { ok: false, status: 401 };
  if (OWNER_USER_ID && userId !== OWNER_USER_ID) return { ok: false, status: 403 };
  return { ok: true };
}

// Submit feedback — any signed-in user.
export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Sign in to send feedback" }, { status: 401 });

    const body = await req.json();
    const message = String(body?.message ?? "").trim();
    if (!message) return NextResponse.json({ error: "Message is required" }, { status: 400 });
    if (message.length > 5000) {
      return NextResponse.json({ error: "Message too long" }, { status: 400 });
    }

    const user = await currentUser();
    const email = user?.emailAddresses?.[0]?.emailAddress ?? null;

    const row = await addFeedback({
      clerk_user_id: userId,
      email,
      category: body?.category ? String(body.category) : "note",
      message,
      page: body?.page ? String(body.page) : null,
    });
    return NextResponse.json({ ok: true, feedback: row });
  } catch (err) {
    return NextResponse.json({ error: "Feedback save failed", detail: String(err) }, { status: 500 });
  }
}

// Read the feed — owner only.
export async function GET(req: NextRequest) {
  try {
    const gate = await ownerGate();
    if (!gate.ok) return NextResponse.json({ error: "Forbidden" }, { status: gate.status });

    const status = req.nextUrl.searchParams.get("status") || undefined;
    const items = await listFeedback({ status });
    const openCount = (await listFeedback({ status: "open", limit: 1000 })).length;
    return NextResponse.json({ items, openCount });
  } catch (err) {
    return NextResponse.json({ error: "Feedback load failed", detail: String(err) }, { status: 500 });
  }
}

// Resolve / reopen — owner only.
export async function PATCH(req: NextRequest) {
  try {
    const gate = await ownerGate();
    if (!gate.ok) return NextResponse.json({ error: "Forbidden" }, { status: gate.status });

    const body = await req.json();
    const id = Number(body?.id ?? 0);
    const status = body?.status === "open" ? "open" : "resolved";
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

    await setFeedbackStatus(id, status);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: "Feedback update failed", detail: String(err) }, { status: 500 });
  }
}
