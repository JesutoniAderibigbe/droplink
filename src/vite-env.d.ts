/// <reference types="svelte" />
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_VAPID_PUBLIC_KEY: string;
  /** "true" shows "Continue with Google" (only once Google is set up in Supabase). */
  readonly VITE_ENABLE_GOOGLE_LOGIN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
