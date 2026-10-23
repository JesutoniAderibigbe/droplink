import { supabase } from '../supabase';

const STUN_ONLY: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
];

let cached: { servers: RTCIceServer[]; expiresAt: number } | null = null;

/**
 * ICE servers from the turn-credentials Edge Function (STUN + short-lived
 * Cloudflare TURN). Cached until 80% of the TTL. Falls back to STUN only if
 * the function fails, so direct connections on friendly networks still work.
 */
export async function getIceServers(): Promise<RTCIceServer[]> {
  if (cached && Date.now() < cached.expiresAt) return cached.servers;
  try {
    const { data, error } = await supabase.functions.invoke<{
      iceServers: RTCIceServer[];
      ttl: number;
    }>('turn-credentials', { method: 'POST' });
    if (error || !data?.iceServers?.length) throw error ?? new Error('no ice servers');
    cached = { servers: data.iceServers, expiresAt: Date.now() + data.ttl * 800 };
    return data.iceServers;
  } catch (e) {
    console.warn('[ice] turn-credentials failed, using STUN only', (e as Error)?.message);
    return STUN_ONLY;
  }
}
