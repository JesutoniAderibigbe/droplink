import { defineConfig } from 'vitest/config';
import { execSync } from 'node:child_process';

// RLS tests talk to the local Supabase stack (`npm run db:start`). Pull the
// URL and keys from the CLI so nothing is hardcoded.
function localSupabaseEnv(): Record<string, string> {
  if (
    process.env.SUPABASE_URL &&
    process.env.SUPABASE_ANON_KEY &&
    process.env.SUPABASE_SERVICE_ROLE_KEY
  ) {
    return {};
  }
  const out = execSync('supabase status -o json', {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const s = JSON.parse(out.slice(out.indexOf('{')));
  return {
    SUPABASE_URL: s.API_URL,
    SUPABASE_ANON_KEY: s.ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: s.SERVICE_ROLE_KEY,
  };
}

export default defineConfig({
  test: {
    include: ['tests/rls/**/*.test.ts'],
    environment: 'node',
    env: localSupabaseEnv(),
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
