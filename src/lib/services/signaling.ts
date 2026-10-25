// Presence + addressed Broadcast on private Realtime channels.
//
// - `Signaling` is one channel: "user:{userId}" (my devices) or
//   "pair:{a}:{b}" (my devices and one contact's).
// - Presence key is the device id, payload { deviceId, name, kind }.
// - Broadcast events are the signal types in core/signal.ts. Everyone on the
//   channel receives every message; we drop anything not addressed to us.
// - The channels are private, so Realtime checks the RLS policies on
//   realtime.messages (see migrations/*_realtime.sql and *_contacts.sql):
//   only the owner joins a user channel, only the two contacts a pair channel.
// - `SignalHub` is what the rest of the app talks to: it routes each message
//   to the channel of whoever owns the target device and merges presence.

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

/** What the transfer engine and WebRTC peer need from signaling. */
export interface SignalBus {
  readonly deviceId: string;
  on<T extends SignalType>(type: T, handler: Handler<T>): () => void;
  send<T extends SignalType>(type: T, payload: Omit<SignalMap[T], 'from'>): Promise<void>;
}

export interface SignalingEvents {
  onPresence(online: Map<string, PresenceMeta>): void;
  onStatus?(status: 'connecting' | 'connected' | 'disconnected'): void;
}

export class Signaling implements SignalBus {
  private channel: RealtimeChannel | null = null;
  private handlers = new Map<SignalType, Set<Handler<SignalType>>>();
  private online = new Map<string, PresenceMeta>();
  private stopped = false;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private retries = 0;

  constructor(
    private readonly supabase: SupabaseClient,
    private readonly topic: string,
    private readonly self: PresenceMeta,
    private readonly events: SignalingEvents,
    /** Extra check on who a message claims to be from (pair channels). */
    private readonly accept: (from: string) => boolean = () => true,
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

    const channel = this.supabase.channel(this.topic, {
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
    if (!this.accept(msg.from)) return;
    for (const h of this.handlers.get(type) ?? []) {
      try {
        h(msg);
      } catch (e) {
        console.error('[signaling] handler failed', type, e);
      }
    }
  }
}

// ---------------------------------------------------------------------------

export interface HubOptions {
  supabase: SupabaseClient;
  userId: string;
  self: PresenceMeta;
  /** User id that owns a device we know (mine or a contact's). */
  ownerOf(deviceId: string): string | undefined;
  onPresence(online: Map<string, PresenceMeta>): void;
  onStatus(status: 'connecting' | 'connected' | 'disconnected'): void;
  /** A contact's device we haven't loaded yet showed up: reload contacts. */
  onUnknownDevice(contactId: string): void;
}

/** "pair:{a}:{b}" with the two user ids in sorted order (matches the RLS check). */
export function pairTopic(x: string, y: string): string {
  const [a, b] = [x.toLowerCase(), y.toLowerCase()].sort();
  return `pair:${a}:${b}`;
}

export class SignalHub implements SignalBus {
  private own: Signaling;
  private ownOnline = new Map<string, PresenceMeta>();
  private pairs = new Map<string, { sig: Signaling; online: Map<string, PresenceMeta> }>();
  private handlers = new Map<SignalType, Set<Handler<SignalType>>>();
  private started = false;
  private contacts: string[] = [];

  constructor(private readonly o: HubOptions) {
    this.own = this.wire(
      new Signaling(o.supabase, `user:${o.userId}`, o.self, {
        onPresence: (m) => {
          this.ownOnline = m;
          this.emitPresence();
        },
        onStatus: o.onStatus,
      }),
    );
  }

  get deviceId(): string {
    return this.o.self.deviceId;
  }

  async start(): Promise<void> {
    this.started = true;
    await this.own.start();
    this.setContacts(this.contacts);
  }

  stop(): void {
    this.started = false;
    this.own.stop();
    for (const p of this.pairs.values()) p.sig.stop();
    this.pairs.clear();
  }

  /** Join a pair channel per accepted contact, leave the ones that are gone. */
  setContacts(ids: string[]): void {
    this.contacts = ids;
    if (!this.started) return;
    for (const [id, p] of this.pairs) {
      if (ids.includes(id)) continue;
      p.sig.stop();
      this.pairs.delete(id);
    }
    for (const id of ids) {
      if (this.pairs.has(id)) continue;
      const entry = { sig: null as unknown as Signaling, online: new Map<string, PresenceMeta>() };
      entry.sig = this.wire(
        new Signaling(
          this.o.supabase,
          pairTopic(this.o.userId, id),
          { ...this.o.self },
          {
            onPresence: (m) => {
              entry.online = m;
              this.emitPresence();
            },
          },
          // Only the contact's own devices may speak for them on this channel.
          (from) => this.o.ownerOf(from) === id,
        ),
      );
      this.pairs.set(id, entry);
      void entry.sig.start();
    }
    this.emitPresence();
  }

  async updateSelf(meta: Partial<Omit<PresenceMeta, 'deviceId'>>): Promise<void> {
    Object.assign(this.o.self, meta);
    await Promise.all([
      this.own.updateSelf(meta),
      ...[...this.pairs.values()].map((p) => p.sig.updateSelf(meta)),
    ]);
  }

  on<T extends SignalType>(type: T, handler: Handler<T>): () => void {
    let set = this.handlers.get(type);
    if (!set) this.handlers.set(type, (set = new Set()));
    set.add(handler as Handler<SignalType>);
    return () => set.delete(handler as Handler<SignalType>);
  }

  async send<T extends SignalType>(type: T, payload: Omit<SignalMap[T], 'from'>): Promise<void> {
    const owner = this.o.ownerOf((payload as { to: string }).to);
    if (owner && owner !== this.o.userId) {
      const pair = this.pairs.get(owner);
      if (!pair) throw new Error('Not connected to that contact');
      return pair.sig.send(type, payload);
    }
    return this.own.send(type, payload);
  }

  private wire(sig: Signaling): Signaling {
    for (const type of SIGNAL_TYPES) {
      sig.on(type, (msg) => {
        for (const h of this.handlers.get(type) ?? []) h(msg);
      });
    }
    return sig;
  }

  private emitPresence(): void {
    const merged = new Map(this.ownOnline);
    for (const [contactId, p] of this.pairs) {
      for (const [deviceId, meta] of p.online) {
        const owner = this.o.ownerOf(deviceId);
        if (owner === contactId) merged.set(deviceId, meta);
        else if (owner === undefined) this.o.onUnknownDevice(contactId);
        // else: one of my own devices, also present on the pair channel.
      }
    }
    this.o.onPresence(merged);
  }
}
