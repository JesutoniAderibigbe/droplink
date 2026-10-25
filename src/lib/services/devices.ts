import { supabase } from '../supabase';
import type { DeviceKind, DeviceRow } from '../core/types';
import { sanitizeDeviceName } from '../core/deviceName';

const columns = 'id, user_id, name, kind, public_key, created_at, last_seen_at, revoked_at';

export async function fetchDevice(id: string): Promise<DeviceRow | null> {
  const { data, error } = await supabase.from('devices').select(columns).eq('id', id).maybeSingle();
  if (error) throw error;
  return data as DeviceRow | null;
}

/** My active devices. (RLS also returns contacts' devices, hence the user filter.) */
export async function listDevices(userId: string): Promise<DeviceRow[]> {
  const { data, error } = await supabase
    .from('devices')
    .select(columns)
    .eq('user_id', userId)
    .is('revoked_at', null)
    .order('last_seen_at', { ascending: false });
  if (error) throw error;
  return data as DeviceRow[];
}

/** Active devices of these contacts. */
export async function listContactDevices(userIds: string[]): Promise<DeviceRow[]> {
  if (userIds.length === 0) return [];
  const { data, error } = await supabase
    .from('devices')
    .select(columns)
    .in('user_id', userIds)
    .is('revoked_at', null)
    .order('last_seen_at', { ascending: false });
  if (error) throw error;
  return data as DeviceRow[];
}

export async function registerDevice(input: {
  id: string;
  userId: string;
  name: string;
  kind: DeviceKind;
  publicJwk: JsonWebKey;
}): Promise<DeviceRow> {
  const { data, error } = await supabase
    .from('devices')
    .insert({
      id: input.id,
      user_id: input.userId,
      name: sanitizeDeviceName(input.name) || 'My device',
      kind: input.kind,
      public_key: input.publicJwk,
    })
    .select(columns)
    .single();
  if (error) throw error;
  return data as DeviceRow;
}

export async function renameDevice(id: string, name: string): Promise<void> {
  const clean = sanitizeDeviceName(name);
  if (!clean) throw new Error('Name cannot be empty');
  const { error } = await supabase.from('devices').update({ name: clean }).eq('id', id);
  if (error) throw error;
}

/** Remove a device: marks it revoked; a DB trigger deletes its push subscriptions. */
export async function revokeDevice(id: string): Promise<void> {
  const { error } = await supabase
    .from('devices')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

export async function touchLastSeen(id: string): Promise<void> {
  const { error } = await supabase
    .from('devices')
    .update({ last_seen_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}
