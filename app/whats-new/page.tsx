import WhatsNewClient from "./WhatsNewClient";
import { loadCustomerChangelog } from "@/lib/whatsNewChangelog";
import { readHidden, hideKey } from "@/lib/whatsNewHidden";
import { getServerUserId } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Same fail-closed owner check the hide API uses. Kept on the env var (not
// session.isOwner) so the page and app/api/whats-new/route.ts can never
// disagree about who may see the hidden list.
const OWNER_USER_ID = (process.env.OWNER_USER_ID || "").trim();

export default async function WhatsNewPage() {
  const [entries, hidden, userId] = await Promise.all([
    loadCustomerChangelog(),
    readHidden(),
    getServerUserId(),
  ]);

  // CUSTOMER_CHANGELOG.md is the source of truth; the hidden list is the only
  // thing that subtracts from it. Nothing on the site edits the markdown.
  const hiddenKeys = new Set(hidden.map((h) => hideKey(h.date, h.item)));
  const visible = entries
    .map((e) => ({ ...e, items: e.items.filter((it) => !hiddenKeys.has(hideKey(e.date, it))) }))
    .filter((e) => e.items.length > 0);

  const isOwner = !!OWNER_USER_ID && userId === OWNER_USER_ID;

  return (
    <WhatsNewClient
      entries={visible}
      // Only the owner ever receives the text of hidden bullets.
      hidden={isOwner ? hidden : []}
    />
  );
}
