import { createClient } from '@supabase/supabase-js';

const configuredUrl = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!configuredUrl || !anonKey) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY (see .env.example)');
}

/**
 * "same-origin" means the dev server proxies Supabase (see vite.config.ts), so
 * a phone on the LAN only needs to trust one HTTPS origin.
 */
export const supabaseUrl = configuredUrl === 'same-origin' ? location.origin : configuredUrl;

export const supabase = createClient(supabaseUrl, anonKey, {
  auth: {
    flowType: 'pkce',
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
