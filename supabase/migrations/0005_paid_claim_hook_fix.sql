-- ============================================================================
-- Fix custom_access_token_hook: read is_paid from public.subscription_status
-- (Supabase-local, see 0004) instead of public.subscriptions (Render-only,
-- unreachable from this DB). Re-run in the Supabase SQL editor.
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

  select exists (
    select 1 from public.subscription_status s
     where s.user_id = uid::uuid
       and s.status in ('active', 'trialing')
  ) into is_paid;

  claims := coalesce(event->'claims', '{}'::jsonb);
  claims := jsonb_set(claims, '{is_owner}', to_jsonb(coalesce(is_owner, false)));
  claims := jsonb_set(claims, '{is_paid}',  to_jsonb(coalesce(is_paid,  false)));

  return jsonb_set(event, '{claims}', claims);
end;
$$;
