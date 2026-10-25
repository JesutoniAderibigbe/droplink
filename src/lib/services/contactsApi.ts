// People you can send to. All changes go through RPCs (see
// migrations/*_contacts.sql); the contacts table itself isn't readable.
import { supabase } from '../supabase';

export interface Contact {
  userId: string;
  name: string;
  /** Only while a request is pending, so you can check who it's from. */
  email: string | null;
  status: 'pending' | 'accepted';
  /** A request they sent me (as opposed to one I sent). */
  incoming: boolean;
  createdAt: string;
}

export async function listContacts(): Promise<Contact[]> {
  const { data, error } = await supabase.rpc('my_contacts');
  if (error) throw error;
  return (data ?? []).map(
    (r: {
      user_id: string;
      display_name: string;
      email: string | null;
      status: 'pending' | 'accepted';
      incoming: boolean;
      created_at: string;
    }) => ({
      userId: r.user_id,
      name: r.display_name,
      email: r.email,
      status: r.status,
      incoming: r.incoming,
      createdAt: r.created_at,
    }),
  );
}

export type RequestResult = 'requested' | 'accepted' | 'already_contacts' | 'not_found' | 'self';

export async function requestContact(email: string): Promise<RequestResult> {
  const { data, error } = await supabase.rpc('request_contact', { p_email: email.trim() });
  if (error) throw error;
  return data as RequestResult;
}

export async function respondContact(userId: string, accept: boolean): Promise<void> {
  const { error } = await supabase.rpc('respond_contact', { p_other: userId, p_accept: accept });
  if (error) throw error;
}

export async function removeContact(userId: string): Promise<void> {
  const { error } = await supabase.rpc('remove_contact', { p_other: userId });
  if (error) throw error;
}

export interface Invite {
  token: string;
  expiresAt: number;
}

export async function createInvite(): Promise<Invite> {
  const { data, error } = await supabase.rpc('create_contact_invite');
  if (error) throw error;
  const row = (data as { token: string; expires_at: string }[])[0];
  return { token: row.token, expiresAt: Date.parse(row.expires_at) };
}

/** Returns the inviter. */
export async function acceptInvite(token: string): Promise<{ userId: string; name: string }> {
  const { data, error } = await supabase.rpc('accept_contact_invite', { p_token: token });
  if (error) throw error;
  const row = (data as { user_id: string; display_name: string }[])[0];
  return { userId: row.user_id, name: row.display_name };
}

export function inviteUrl(token: string): string {
  return `${location.origin}/add?invite=${token}`;
}
