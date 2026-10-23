-- Scheduled relay cleanup with pg_cron.
--
-- Every hour pg_cron
--   1. marks expired transfers that have no relay objects (pure SQL, works
--      even if the Edge Function isn't deployed), and
--   2. calls the relay-cleanup Edge Function through pg_net, which deletes
--      Storage objects (not possible from SQL) for expired, finished and
--      abandoned relays.
-- The function URL and shared secret come from Vault, so nothing
-- environment-specific is in this migration. Set them once per project:
--   select vault.create_secret('https://<ref>.supabase.co/functions/v1/relay-cleanup', 'droplink_cleanup_url');
--   select vault.create_secret('<random secret>', 'droplink_cron_secret');
-- (and the same secret as CRON_SECRET in the function's secrets). Local
-- values are set in supabase/seed.sql.

create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function private.run_relay_cleanup() returns void
language plpgsql security definer set search_path = '' as $$
declare
  fn_url text;
  secret text;
begin
  update public.transfers t
     set status = 'expired'
   where t.status in ('pending', 'p2p', 'relayed')
     and t.expires_at < now()
     and not exists (select 1 from public.relay_objects r where r.transfer_id = t.id);

  select decrypted_secret into fn_url from vault.decrypted_secrets where name = 'droplink_cleanup_url';
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'droplink_cron_secret';
  if fn_url is null or secret is null then
    raise warning 'droplink: relay cleanup function not configured in Vault; skipped storage cleanup';
    return;
  end if;
  perform net.http_post(
    url := fn_url,
    headers := jsonb_build_object('content-type', 'application/json', 'x-cron-secret', secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
end $$;
revoke all on function private.run_relay_cleanup() from public, anon, authenticated;

select cron.schedule('droplink-relay-cleanup', '7 * * * *', 'select private.run_relay_cleanup()');
