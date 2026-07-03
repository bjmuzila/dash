-- ============================================================================
-- Extend custom_access_token_hook — also inject `is_paid` into the JWT.
-- Run in the Supabase SQL editor (the Customize-Access-Token hook is already
-- enabled from 0002; re-running create-or-replace updates it in place).
--
-- Why: the paywall was enforced ONLY in app/home/layout.tsx. Every other
-- dashboard route was sign-in gated but NOT subscription gated, so a signed-in
-- unpaid user (e.g. Back button off Stripe checkout) could use the whole app.
-- Baking `is_paid` into the signed JWT lets middleware.ts gate every protected
-- route with no DB call in the edge runtime — same pattern as `is_owner`.
--
-- PREREQUISITE — verify before relying on this:
--   The `subscriptions` table (written by the Stripe webhook) must live in the
--   SAME Postgres database this hook runs in (the Supabase project DB). If your
--   app's DATABASE_URL points at a SEPARATE Postgres (e.g. Render), this hook
--   cannot see it — in that case mirror paid status into a Supabase-side table
--   the webhook also writes, and read THAT here.
-- ============================================================================

create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  claims   jsonb;
  uid      text := event->>'user_id';
  is_owner boolean;
  is_paid  boolean;
begin
  select (ao.owner_id = uid::uuid)
    into is_owner
    from public.app_owner ao
   where ao.id is true;

  -- Paid = an active/trialing subscription row for this user.
  select exists (
    select 1 from public.subscriptions s
     where s.clerk_user_id = uid
       and s.status in ('active', 'trialing')
  ) into is_paid;

  claims := coalesce(event->'claims', '{}'::jsonb);
  claims := jsonb_set(claims, '{is_owner}', to_jsonb(coalesce(is_owner, false)));
  claims := jsonb_set(claims, '{is_paid}',  to_jsonb(coalesce(is_paid,  false)));

  return jsonb_set(event, '{claims}', claims);
end;
$$;

-- The hook role needs to read subscriptions.
grant select on public.subscriptions to supabase_auth_admin;
