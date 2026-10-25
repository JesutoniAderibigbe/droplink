#!/usr/bin/env bash
# Runs the notify-device integration test (tests/rls/push.test.ts) against the
# local stack with a mock HTTPS push service. Local-only plumbing:
#  - makes a throwaway CA + leaf certificate for host.docker.internal,
#  - serves functions with your supabase/functions/.env plus DENO_TLS_CA_STORE=system,
#  - adds the CA to the edge-runtime container's trust store (gone when the
#    container restarts).
# Needs: supabase start, VAPID keys in supabase/functions/.env (npm run vapid).
set -euo pipefail
cd "$(dirname "$0")/.."
TMP=$(mktemp -d)
trap 'kill $SERVE_PID 2>/dev/null || true; rm -rf "$TMP"' EXIT

openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -keyout "$TMP/ca-key.pem" \
  -out "$TMP/ca.pem" -days 1 -subj "/CN=DropLink Test CA" 2>/dev/null
openssl req -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -keyout "$TMP/key.pem" \
  -out "$TMP/leaf.csr" -subj "/CN=host.docker.internal" 2>/dev/null
printf "subjectAltName=DNS:host.docker.internal\nbasicConstraints=CA:FALSE\nextendedKeyUsage=serverAuth\n" > "$TMP/leaf.ext"
openssl x509 -req -in "$TMP/leaf.csr" -CA "$TMP/ca.pem" -CAkey "$TMP/ca-key.pem" -CAcreateserial \
  -out "$TMP/cert.pem" -days 1 -extfile "$TMP/leaf.ext" 2>/dev/null

cp supabase/functions/.env "$TMP/functions.env"
echo "DENO_TLS_CA_STORE=system" >> "$TMP/functions.env"
pkill -f "supabase functions serve" 2>/dev/null || true
supabase functions serve --env-file "$TMP/functions.env" > "$TMP/serve.log" 2>&1 &
SERVE_PID=$!
CONTAINER=$(docker ps --format '{{.Names}}' | grep '^supabase_edge_runtime_' | head -1 || true)
for _ in $(seq 1 30); do [ -n "$CONTAINER" ] && break; sleep 1; CONTAINER=$(docker ps --format '{{.Names}}' | grep '^supabase_edge_runtime_' | head -1 || true); done
sleep 3
docker cp "$TMP/ca.pem" "$CONTAINER:/usr/local/share/ca-certificates/droplink-test-ca.crt"
docker exec "$CONTAINER" update-ca-certificates >/dev/null

PUSH_MOCK_CERT="$TMP/cert.pem" PUSH_MOCK_KEY="$TMP/key.pem" npx vitest run --config vitest.rls.config.ts tests/rls/push.test.ts
