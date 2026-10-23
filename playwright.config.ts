import { defineConfig } from '@playwright/test';

// End-to-end tests drive two isolated browser contexts (= two devices) against
// the local dev server and local Supabase. Start both first:
//   npm run db:start && npm run dev
export default defineConfig({
  testDir: 'e2e',
  timeout: 10 * 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  expect: { timeout: 15_000 },
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'https://localhost:5173',
    ignoreHTTPSErrors: true,
    actionTimeout: 20_000,
    launchOptions: {
      // Use real host candidates instead of mDNS names so two contexts on one
      // machine can connect without a STUN round trip.
      args: ['--disable-features=WebRtcHideLocalIpsWithMdns'],
    },
  },
});
