-- Local development only (runs on `supabase db reset`).
-- Lets pg_cron reach the local relay-cleanup function from inside Docker.
-- Keep CRON_SECRET in supabase/functions/.env equal to the secret below.
select vault.create_secret('http://kong:8000/functions/v1/relay-cleanup', 'droplink_cleanup_url');
select vault.create_secret('local-dev-cron-secret', 'droplink_cron_secret');
