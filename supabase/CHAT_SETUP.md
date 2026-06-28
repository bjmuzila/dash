# Subscriber chat — Supabase Realtime wiring

Single global room. All signed-in users are paid, so RLS == authenticated.
Auth bridges Clerk → Supabase via a JWT template (no Supabase Auth sessions).

## 1. Install dep
```
npm i @supabase/supabase-js
```

## 2. Create the Supabase project
supabase.com → New project. Then **Settings → API**, copy:
- Project URL
- `anon` public key
- JWT Secret (used in step 4)

## 3. Env vars (.env.local)
```
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
```

## 4. Connect Clerk as a Supabase third-party auth provider
The old JWT-template method is DEPRECATED (April 2025). Use native integration:
- Clerk dashboard → Supabase integration → **Connect with Supabase** (one-click), OR
- Supabase dashboard → **Authentication → Third-Party Auth → Add provider → Clerk**,
  paste your Clerk domain (Frontend API URL, e.g. `precious-kingfish-58.clerk.accounts.dev`).
- No JWT template, no shared secret. Clerk's default session token carries `sub` = Clerk user id, which RLS reads.

## 5. Run the migration
Supabase dashboard → SQL Editor → paste `migrations/0001_chat_messages.sql` → Run.
(Or `supabase db push` if using the CLI.)

## 6. Enable Realtime
The migration already runs `alter publication supabase_realtime add table chat_messages`.
Confirm under **Database → Replication → supabase_realtime** that `chat_messages` is listed.

## 7. Route
Page is live at `/chat`. Add it to nav (NavMenu) if you want it in the sidebar.

## Files added
- `supabase/migrations/0001_chat_messages.sql` — table + RLS + realtime
- `lib/supabase.ts` — Clerk-authed browser client
- `hooks/useChat.ts` — load + realtime subscription + send
- `app/chat/page.tsx` — themed chat UI

## Notes / gotchas
- RLS denies UPDATE/DELETE from clients by omission (no policy). Add policies only if needed.
- `accessToken` callback hands Clerk's JWT to Supabase on every request, so token refresh is automatic — no Supabase session to expire.
- If messages load but realtime is silent: check the table is in the `supabase_realtime` publication (step 6) and that RLS `chat_read` returns true for `authenticated`.
- `@supabase/supabase-js` v2.45+ is required for the `accessToken` client option.
