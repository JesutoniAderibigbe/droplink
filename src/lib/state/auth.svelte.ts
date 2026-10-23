import type { Session } from '@supabase/supabase-js';
import { supabase } from '../supabase';

export const auth = $state<{ ready: boolean; session: Session | null }>({
  ready: false,
  session: null,
});

supabase.auth.getSession().then(({ data }) => {
  auth.session = data.session;
  auth.ready = true;
});

supabase.auth.onAuthStateChange((_event, session) => {
  auth.session = session;
  auth.ready = true;
});

export function redirectUrl(): string {
  // Come back to wherever the user was (e.g. /send?shared=1 after sharing while
  // signed out) once auth completes.
  return location.origin + location.pathname + location.search;
}

export async function signInWithGoogle(): Promise<void> {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: redirectUrl() },
  });
  if (error) throw error;
}

export async function sendMagicLink(email: string): Promise<void> {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: redirectUrl() },
  });
  if (error) throw error;
}

/** Verify the 6-digit code from the email (works inside installed PWAs too). */
export async function verifyEmailCode(email: string, token: string): Promise<void> {
  const { error } = await supabase.auth.verifyOtp({ email, token, type: 'email' });
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}
