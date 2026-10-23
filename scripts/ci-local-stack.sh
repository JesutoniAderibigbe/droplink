#!/usr/bin/env bash
# CI helper: start local Supabase + Edge Functions and write the env files the
# tests and dev server expect. Throwaway keys, generated per run.
set -euo pipefail
supabase start -x studio,imgproxy,logflare,vector,supavisor
STATUS=$(supabase status -o json | sed -n '/{/,$p')
ANON=$(echo "$STATUS" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).ANON_KEY))')
node scripts/gen-vapid.mjs > /tmp/vapid.env
PUB=$(grep '^VITE_VAPID_PUBLIC_KEY=' /tmp/vapid.env | cut -d= -f2)
{
  grep -E '^VAPID_' /tmp/vapid.env
  echo "VAPID_SUBJECT=mailto:ci@example.com"
  echo "CRON_SECRET=local-dev-cron-secret"
} > supabase/functions/.env
cat > .env.local <<ENV
VITE_SUPABASE_URL=same-origin
VITE_SUPABASE_ANON_KEY=$ANON
VITE_VAPID_PUBLIC_KEY=$PUB
SUPABASE_PROXY_TARGET=http://127.0.0.1:55321
ENV
nohup supabase functions serve --env-file supabase/functions/.env > /tmp/functions.log 2>&1 &
for _ in $(seq 1 60); do
  curl -s -o /dev/null -w '%{http_code}' -X POST http://127.0.0.1:55321/functions/v1/turn-credentials | grep -q 401 && break
  sleep 2
done
echo "local stack ready"
