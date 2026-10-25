// The user's name (profiles.display_name), for the greeting and Settings.
import { supabase } from '../supabase';
import { auth } from './auth.svelte';
import { MAX_NAME_LENGTH, realName } from '../core/greeting';

export const profile = $state<{ name: string; loaded: boolean }>({ name: '', loaded: false });

export async function loadProfile(): Promise<void> {
  const { data } = await supabase.from('profiles').select('display_name').maybeSingle();
  profile.name = realName(data?.display_name, auth.session?.user.email);
  profile.loaded = true;
}

export async function saveName(name: string): Promise<void> {
  const value = name.trim().slice(0, MAX_NAME_LENGTH);
  const uid = auth.session?.user.id;
  if (!value || !uid) return;
  const { error } = await supabase.from('profiles').update({ display_name: value }).eq('id', uid);
  if (error) throw error;
  profile.name = value;
}
