// Presence + addressed Broadcast on the private Realtime channel user:{userId}.
//
// - Presence key is the device id, payload { deviceId, name, kind }.
// - Broadcast events are the signal types in core/signal.ts. Every device of
//   the user receives every message; we drop anything not addressed to us.
// - The channel is private, so Realtime checks the RLS policies on
//   realtime.messages (see migrations/*_realtime.sql) and only the owner of
//   the user id can join.

import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import {
  parsePresence,
  parseSignal,
  SIGNAL_TYPES,
  type PresenceMeta,
  type SignalMap,
  type SignalType,
} from '../core/signal';

type Handler<T extends SignalType> = (msg: SignalMap[T]) => void;

export interface SignalingEvents {
  onPresence(online: Map<string, PresenceMeta>): void;
  onStatus?(status: 'connecting' | 'connected' | 'disconnected'): void;
}

export class Signaling {
  private channel: RealtimeChannel | null = null;
  private handlers = new Map<SignalType, Set<Handler<SignalType>>>();
  private online = new Map<string, PresenceMeta>();
  private stopped = false;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private retries = 0;

  constructor(
    private readonly supabase: SupabaseClient,
    private readonly userId: string,
    private readonly self: PresenceMeta,
    private readonly events: SignalingEvents,
  ) {}

  get deviceId(): string {
    return this.self.deviceId;
  }

  isOnline(deviceId: string): boolean {
    return this.online.has(deviceId);
  }

  async start(): Promise<void> {
    this.stopped = false;
    window.addEventListener('online', this.onNetworkBack);
    document.addEventListener('visibilitychange', this.onVisible);
    await this.connect();
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.retryTimer);
    window.removeEventListener('online', this.onNetworkBack);
    document.removeEventListener('visibilitychange', this.onVisible);
    const ch = this.channel;
    this.channel = null;
    if (ch) void this.supabase.removeChannel(ch);
    this.online.clear();
    this.events.onPresence(new Map());
  }

  /** Update what other devices see for us (e.g. after a rename). */
  async updateSelf(meta: Partial<Omit<PresenceMeta, 'deviceId'>>): Promise<void> {
    Object.assign(this.self, meta);
    await this.channel?.track({ ...this.self });
  }

  on<T extends SignalType>(type: T, handler: Handler<T>): () => void {
    let set = this.handlers.get(type);
    if (!set) this.handlers.set(type, (set = new Set()));
    set.add(handler as Handler<SignalType>);
    return () => set.delete(handler as Handler<SignalType>);
  }

  async send<T extends SignalType>(type: T, payload: Omit<SignalMap[T], 'from'>): Promise<void> {
    if (!this.channel) throw new Error('Not connected to signaling');
    const res = await this.channel.send({
      type: 'broadcast',
      event: type,
      payload: { ...payload, from: this.deviceId },
    });
    if (res !== 'ok') throw new Error(`Signaling send failed (${res})`);
  }

  private onNetworkBack = () => {
    if (!this.channel && !this.stopped) void this.connect();
  };

  private onVisible = () => {
    // Mobile browsers freeze background tabs and the socket can die silently.
    if (document.visibilityState === 'visible' && !this.channel && !this.stopped)
      void this.connect();
  };

  private async connect(): Promise<void> {
    if (this.stopped) return;
    this.events.onStatus?.('connecting');
    // Private channels authenticate with the user's JWT.
    const { data } = await this.supabase.auth.getSession();
    if (data.session) await this.supabase.realtime.setAuth(data.session.access_token);

    const channel = this.supabase.channel(`user:${this.userId}`, {
      config: {
        private: true,
        presence: { key: this.self.deviceId },
        broadcast: { self: false, ack: true },
      },
    });

    for (const type of SIGNAL_TYPES) {
      channel.on('broadcast', { event: type }, ({ payload }) => this.dispatch(type, payload));
    }
    channel.on('presence', { event: 'sync' }, () => this.syncPresence(channel));

    this.channel = channel;
    channel.subscribe(async (status, err) => {
      if (this.channel !== channel) return;
      if (status === 'SUBSCRIBED') {
        this.retries = 0;
        await channel.track({ ...this.self });
        this.events.onStatus?.('connected');
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        if (err) console.warn('[signaling]', status, err.message);
        this.events.onStatus?.('disconnected');
        this.online.clear();
        this.events.onPresence(new Map());
        this.channel = null;
        void this.supabase.removeChannel(channel);
        this.scheduleRetry();
      }
    });
  }

  private scheduleRetry(): void {
    if (this.stopped) return;
    clearTimeout(this.retryTimer);
    const delay = Math.min(30_000, 1000 * 2 ** this.retries++) + Math.random() * 500;
    this.retryTimer = setTimeout(() => void this.connect(), delay);
  }

  private syncPresence(channel: RealtimeChannel): void {
    const state = channel.presenceState();
    const next = new Map<string, PresenceMeta>();
    for (const metas of Object.values(state)) {
      for (const raw of metas) {
        const meta = parsePresence(raw);
        if (meta && meta.deviceId !== this.deviceId) next.set(meta.deviceId, meta);
      }
    }
    this.online = next;
    this.events.onPresence(new Map(next));
  }

  private dispatch(type: SignalType, raw: unknown): void {
    const msg = parseSignal(type, raw);
    if (!msg || msg.to !== this.deviceId) return; // not for us (or malformed)
    for (const h of this.handlers.get(type) ?? []) {
      try {
        h(msg);
      } catch (e) {
        console.error('[signaling] handler failed', type, e);
      }
    }
  }
}
