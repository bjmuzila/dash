# Landing page + auth — setup

## 1. Install deps
```
npm install
```
(Adds `@clerk/nextjs` + `@clerk/themes`.)

## 2. Create a Clerk app
- Sign up at https://dashboard.clerk.com → create an application.
- Enable the sign-in methods you want (email/password, Google, etc.).
- Copy **Publishable key** and **Secret key** from API Keys.

## 3. Fill in `.env.local`
```
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
WAITLIST_ADMIN_SECRET=<any random string>
```
The other `NEXT_PUBLIC_CLERK_*` URL vars are already set to this app's routes.

## 4. Run
```
npm run dev
```
The `waitlist` table is auto-created on first signup (same `lib/db.ts` pattern as the rest of the app).

## How it works
- `/` → **landing page** (blurred dashboard mock + explainer + email capture + sign-in). Signed-in users are redirected to `/home`.
- Every other route is **protected** by `middleware.ts`. Signed-out visitors are bounced to `/`.
- Sign in / Create account use Clerk modal popups; `/sign-in` and `/sign-up` exist as fallback pages.
- Sign-out: the **UserButton** at the bottom of the sidebar (replaces the old logo).

## Email signups
- Stored in Postgres `waitlist` table.
- Export: `GET /api/waitlist?secret=<WAITLIST_ADMIN_SECRET>` → JSON of all emails.

## Auto-export to Google Sheets (optional, real-time)
Every NEW signup is appended to a Google Sheet you own. If the env vars below are
unset, this is skipped silently — signups still save to Postgres either way.

**One-time setup:**
1. Create the sheet you want to use. Copy its ID from the URL:
   `https://docs.google.com/spreadsheets/d/`**`THIS_PART`**`/edit`
2. Google Cloud Console (https://console.cloud.google.com):
   - Create / pick a project → **APIs & Services → Library** → enable **Google Sheets API**.
   - **APIs & Services → Credentials → Create credentials → Service account.** Name it, create.
   - Open the service account → **Keys → Add key → Create new key → JSON**. A JSON file downloads.
3. From that JSON file, copy two values into `.env.local`:
   - `client_email`  → `GOOGLE_SERVICE_ACCOUNT_EMAIL`
   - `private_key`   → `GOOGLE_PRIVATE_KEY` (keep it on one line, in double quotes, with the `\n` as-is)
   - And set `WAITLIST_SHEET_ID` to the ID from step 1.
4. **Share the Google Sheet with the service-account email** (the `client_email`),
   giving it **Editor** access — exactly like sharing with a person. This is the step
   people forget; without it you'll get a 403.
5. Restart `npm run dev`. The header row is created automatically on first append.

Existing emails already in Postgres are NOT back-filled — only signups going forward
land in the sheet. (Ask if you want a one-time back-fill script.)

## Files added / changed
- `app/page.tsx` — landing (was a redirect to /home)
- `components/landing/LandingClient.tsx`, `components/landing/DashboardMock.tsx`
- `app/sign-in/[[...sign-in]]/page.tsx`, `app/sign-up/[[...sign-up]]/page.tsx`
- `app/api/waitlist/route.ts`, `lib/google-sheets.ts`
- `middleware.ts` (new)
- `app/layout.tsx` (ClerkProvider), `components/shared/LayoutShell.tsx` (bare landing), `components/shared/Sidebar.tsx` (UserButton)
- `lib/db.ts` (waitlist table + helpers), `package.json`, `.env.local`

## "Paid" gating (next step)
Right now any signed-in user reaches the dashboard. To restrict to paying users, gate on a Clerk
**publicMetadata** flag (e.g. `paid: true`) — set it via webhook from your payment provider, then in
`middleware.ts` check `(await auth()).sessionClaims?.metadata?.paid`. Say the word and I'll wire it.
```
