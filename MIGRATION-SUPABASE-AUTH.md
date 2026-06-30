# Clerk → Supabase Auth migration

Replaces Clerk with native Supabase Auth (Google OAuth + email/password).
**Fresh start:** existing Clerk users are not migrated — everyone re-registers.
Per-user rows (prefs, budget, snapshots) keyed to old Clerk ids are orphaned;
that's expected and acceptable per the migration decision.

Build and test this on a branch with a working rollback **before** it touches
the live site. If live auth ever goes down, revert first, debug second.

---

## 0. Branch

```powershell
cd C:\Users\Brandon\Desktop\spx-gex-dashboard-tt-fixed
git checkout -b supabase-auth
```

## 1. Install deps (Clerk out, @supabase/ssr in)

`package.json` is already updated (removed `@clerk/nextjs` + `@clerk/themes`,
added `@supabase/ssr`). Sync node_modules:

```powershell
npm install
```

## 2. Supabase dashboard config (do this in the Supabase project)

1. **Authentication → Providers**
   - Enable **Email** (turn email confirmation ON or OFF — see note below).
   - Enable **Google**: paste the Google OAuth client ID + secret. In Google
     Cloud Console add the authorized redirect URI Supabase shows you
     (`https://<ref>.supabase.co/auth/v1/callback`).
2. **Authentication → URL Configuration**
   - **Site URL**: `https://www.cbedge.net`
   - **Redirect URLs** (allow-list): add
     `https://www.cbedge.net/auth/callback` and, for local dev,
     `http://localhost:3000/auth/callback`.
3. **RLS**: run `supabase/migrations/supabase-auth-rls.sql` in the SQL editor
   (rewrites `chat_messages` policies to `auth.uid()` and re-adds the table to
   the realtime publication).

> Email-confirmation note: if confirmation is **ON**, sign-up shows a
> "check your email" notice and the user clicks a link that hits
> `/auth/callback`. If **OFF**, sign-up logs them straight in. Both are handled.

## 3. Environment variables

Public (inlined at BUILD time — must be present for `npm run build` and passed
as Docker build args; changing them requires a rebuild):

```
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
NEXT_PUBLIC_OWNER_USER_ID=<your Supabase auth user UUID>   # set in step 5
```

Server-only (runtime, in `/opt/dashboard/.env.local` on the VPS — never via git):

```
SUPABASE_SERVICE_ROLE_KEY=<service role key>   # admin user list, chat clear, owner status card
OWNER_USER_ID=<your Supabase auth user UUID>   # set in step 5
DATABASE_URL=...                               # unchanged
# REMOVE: CLERK_SECRET_KEY, NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY, CLERK_AUTHORIZED_PARTIES
```

`WS_AUTH_REQUIRED=1` still gates `/ws/gex`; it now verifies the Supabase session
cookie instead of Clerk. Keep it OFF until you've confirmed signed-in streaming
works, then turn it on.

## 4. Build (hard gate)

```powershell
npx tsc --noEmit
npm run build
```

If either errors, stop and fix before going further. The sandbox that wrote
these files couldn't run the build, so this is the first real typecheck.

## 5. Create the owner account + capture the UUID

1. Run the app (`npm run dev` or the built image), go to `/sign-up`, create your
   owner account (Google or email).
2. In Supabase → Authentication → Users, copy your user's **UUID**.
3. Set BOTH `OWNER_USER_ID` (runtime) and `NEXT_PUBLIC_OWNER_USER_ID` (build) to
   that UUID. Because the public one is build-time, **rebuild** after setting it
   or owner-only nav/cards won't recognize you.

Until `OWNER_USER_ID` is set, the code falls back to "any signed-in user is
owner" so you can't lock yourself out — but owner gating is effectively open in
that window, so set it promptly.

## 6. Smoke test (local or staging) before going live

- Sign up (email) → lands on `/home` (or shows confirm-email notice).
- Sign in with Google → returns via `/auth/callback` → `/home`.
- Sign out from the avatar menu (top-right) → back to landing, protected routes
  redirect to `/`.
- Owner routes (`/dev`, `/budget`) reachable as owner, 404/redirect as a second
  test account.
- `/chat` loads history and sends a message (RLS: insert as self works).
- With `WS_AUTH_REQUIRED=1`, the GEX chain streams while signed in.

## 7. Deploy

Use the normal `/push-prompts` flow. The Docker build args now include the
Supabase public vars (Clerk arg removed). Set the new env on the VPS
`.env.local` before `docker compose up`.

## 8. Rollback (if live auth breaks)

```powershell
git checkout prod
git reset --hard <previous-good-sha>
git push origin prod --force-with-lease
```

On the VPS: `git pull`, rebuild, `up -d`. (See the auth-cutover rule: revert
first, debug after.) Because this is a branch, the simplest rollback is just not
merging it — `main`/`prod` stay on Clerk until you're satisfied.

---

## What changed (file map)

- `lib/supabase/{client,server,middleware}.ts` — new SSR auth clients.
- `lib/supabase.ts` — old Clerk bridge, now a deprecated re-export.
- `middleware.ts` — Supabase session gate (maintenance + public + owner routes).
- `components/auth/AuthProvider.tsx` — `useAuth()` context (replaces Clerk hooks).
- `components/auth/AuthForm.tsx`, `app/sign-in`, `app/sign-up`, `app/auth/callback`
  — themed email/Google auth + OAuth code exchange.
- `components/shared/UserMenu.tsx` — avatar + sign-out (replaces `<UserButton>`).
- All `useUser()`/`useAuth()` client call sites → `@/components/auth/AuthProvider`.
- All server `auth()` → `getServerUserId()` / `getSupabaseServer()` (≈15 routes
  + `ownerGuard.tsx` + `lib/subscription.ts` + `app/page.tsx` + `app/pricing`).
- `app/api/admin/send-email` + `app/api/clerk-status` — user enumeration now via
  Supabase admin API (service-role key).
- `server-v2/ws-auth.js` — verifies Supabase session cookie instead of Clerk.
- `supabase/migrations/supabase-auth-rls.sql` — chat RLS → `auth.uid()`.
- `Dockerfile` / `docker-compose.yml` — dropped the Clerk build arg.
