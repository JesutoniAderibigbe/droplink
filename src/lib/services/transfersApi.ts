import { supabase } from '../supabase';
import type { RelayParams, TransferRow, TransferStatus } from '../core/types';

const columns =
  'id, user_id, from_device_id, to_device_id, status, file_count, total_bytes, relay_params, created_at, delivered_at, expires_at';

export async function createTransfer(input: {
  userId: string;
  from: string;
  to: string;
  fileCount: number;
  totalBytes: number;
}): Promise<TransferRow> {
  const { data, error } = await supabase
    .from('transfers')
    .insert({
      user_id: input.userId,
      from_device_id: input.from,
      to_device_id: input.to,
      file_count: input.fileCount,
      total_bytes: input.totalBytes,
    })
    .select(columns)
    .single();
  if (error) throw error;
  return data as TransferRow;
}

export async function setTransferStatus(id: string, status: TransferStatus): Promise<void> {
  const { error } = await supabase.from('transfers').update({ status }).eq('id', id);
  if (error) throw error;
}

/** Best effort: status is bookkeeping, never a reason to fail a transfer. */
export function trySetStatus(id: string, status: TransferStatus): void {
  setTransferStatus(id, status).catch((e) =>
    console.warn('[transfers] status update failed', status, e?.message),
  );
}

export async function startRelay(id: string, params: RelayParams): Promise<void> {
  const { error } = await supabase.from('transfers').update({ relay_params: params }).eq('id', id);
  if (error) throw error;
}

export async function getTransfer(id: string): Promise<TransferRow | null> {
  const { data, error } = await supabase
    .from('transfers')
    .select(columns)
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data as TransferRow | null;
}

export async function listRecentTransfers(limit = 10): Promise<TransferRow[]> {
  const { data, error } = await supabase
    .from('transfers')
    .select(columns)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data as TransferRow[];
}

/** Relayed transfers waiting for this device to download. */
export async function listRelayedFor(deviceId: string): Promise<TransferRow[]> {
  const { data, error } = await supabase
    .from('transfers')
    .select(columns)
    .eq('to_device_id', deviceId)
    .eq('status', 'relayed')
    .gt('expires_at', new Date().toISOString())
    .order('created_at');
  if (error) throw error;
  return data as TransferRow[];
}
