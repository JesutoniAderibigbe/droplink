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

export const MIN_PASSWORD_LENGTH = 8;

/**
 * Email + password. Email confirmation is off in Supabase, so sign-up returns a
 * session straight away and no email is ever sent.
 */
export async function signUpWithPassword(
  email: string,
  password: string,
  name: string,
): Promise<void> {
  // full_name becomes profiles.display_name (handle_new_user trigger).
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: name.trim() } },
  });
  if (error) throw error;
  // With confirmations off a brand-new user gets a session. An existing email
  // gets no session (Supabase hides whether it exists), so say so plainly.
  if (!data.session) throw new Error('account_exists_or_unconfirmed');
}

export async function signInWithPassword(email: string, password: string): Promise<void> {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}
