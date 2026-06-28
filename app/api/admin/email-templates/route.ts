import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { welcomeEmail, welcomeEmailText, WELCOME_SUBJECT } from "@/lib/emails/welcome";

// Owner-only. Returns rendered email templates (subject + html + text) so the
// /admin/emails compose page can load a preset with one click instead of pasting
// raw HTML. Read-only; does not send anything.
export const dynamic = "force-dynamic";

const OWNER_USER_ID = (process.env.OWNER_USER_ID || "").trim();

type Template = { id: string; label: string; subject: string; html: string; text: string };

function buildTemplates(): Template[] {
  return [
    {
      id: "welcome",
      label: "Beta welcome",
      subject: WELCOME_SUBJECT,
      html: welcomeEmail(),
      text: welcomeEmailText(),
    },
  ];
}

export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (OWNER_USER_ID && userId !== OWNER_USER_ID) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const id = req.nextUrl.searchParams.get("id");
  const templates = buildTemplates();
  if (id) {
    const t = templates.find((x) => x.id === id);
    if (!t) return NextResponse.json({ error: "Unknown template" }, { status: 404 });
    return NextResponse.json({ ok: true, template: t });
  }
  // No id: return the list (id + label only) for a picker.
  return NextResponse.json({
    ok: true,
    templates: templates.map((t) => ({ id: t.id, label: t.label })),
  });
}
