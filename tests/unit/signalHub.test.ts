import { beforeAll, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { pairTopic, SignalHub } from '../../src/lib/services/signaling';
import type { PresenceMeta } from '../../src/lib/core/signal';

// Signaling listens for network/visibility changes; node has neither.
beforeAll(() => {
  const target = { addEventListener() {}, removeEventListener() {}, visibilityState: 'visible' };
  Object.assign(globalThis, { window: target, document: target });
});

type Listener = { type: string; event: string; cb: (x: unknown) => void };

class FakeChannel {
  listeners: Listener[] = [];
  sent: { event: string; payload: Record<string, unknown> }[] = [];
  state: Record<string, PresenceMeta[]> = {};
  constructor(readonly topic: string) {}
  on(type: string, filter: { event: string }, cb: (x: unknown) => void) {
    this.listeners.push({ type, event: filter.event, cb });
    return this;
  }
  subscribe(cb: (status: string) => void) {
    queueMicrotask(() => cb('SUBSCRIBED'));
    return this;
  }
  async track() {}
  async send(m: { event: string; payload: Record<string, unknown> }) {
    this.sent.push(m);
    return 'ok';
  }
  presenceState() {
    return this.state;
  }
  broadcast(event: string, payload: Record<string, unknown>) {
    for (const l of this.listeners)
      if (l.type === 'broadcast' && l.event === event) l.cb({ payload });
  }
  presence(metas: PresenceMeta[]) {
    this.state = Object.fromEntries(metas.map((m) => [m.deviceId, [m]]));
    for (const l of this.listeners) if (l.type === 'presence') l.cb({});
  }
}

const ME = '11111111-1111-4111-8111-111111111111';
const ADA = '22222222-2222-4222-8222-222222222222';
// Device ids (the signal parser only accepts UUIDs).
const D = {
  myPhone: 'a0000000-0000-4000-8000-000000000001',
  myMac: 'a0000000-0000-4000-8000-000000000002',
  adaIphone: 'b0000000-0000-4000-8000-000000000001',
  adaNewLaptop: 'b0000000-0000-4000-8000-000000000002',
  stranger: 'c0000000-0000-4000-8000-000000000001',
};
const T = ['d0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000002'];
const owners: Record<string, string> = {
  [D.myPhone]: ME,
  [D.myMac]: ME,
  [D.adaIphone]: ADA,
};

function setup() {
  const channels = new Map<string, FakeChannel>();
  const supabase = {
    auth: { getSession: async () => ({ data: { session: null } }) },
    realtime: { setAuth: async () => {} },
    channel: (topic: string) => {
      const ch = new FakeChannel(topic);
      channels.set(topic, ch);
      return ch;
    },
    removeChannel: async () => {},
  } as unknown as SupabaseClient;
  let online = new Map<string, PresenceMeta>();
  const unknown: string[] = [];
  const hub = new SignalHub({
    supabase,
    userId: ME,
    self: { deviceId: D.myPhone, name: 'Pixel', kind: 'android' },
    ownerOf: (id) => owners[id],
    onPresence: (m) => (online = m),
    onStatus: () => {},
    onUnknownDevice: (contact) => unknown.push(contact),
  });
  return { hub, channels, online: () => online, unknown };
}

const meta = (deviceId: string): PresenceMeta => ({ deviceId, name: deviceId, kind: 'other' });
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('pairTopic', () => {
  it('is the same from both sides and sorted', () => {
    expect(pairTopic(ME, ADA)).toBe(pairTopic(ADA, ME));
    expect(pairTopic(ADA, ME)).toBe(`pair:${ME}:${ADA}`);
  });
});

describe('SignalHub', () => {
  it('routes to my own channel or the contact pair channel by who owns the target', async () => {
    const { hub, channels } = setup();
    hub.setContacts([ADA]);
    await hub.start();
    await tick();
    await hub.send('transfer-accept', { to: D.myMac, transferId: T[0] });
    await hub.send('transfer-accept', { to: D.adaIphone, transferId: T[1] });
    expect(channels.get(`user:${ME}`)!.sent.map((m) => m.payload.transferId)).toEqual([T[0]]);
    expect(channels.get(pairTopic(ME, ADA))!.sent.map((m) => m.payload.transferId)).toEqual([T[1]]);
  });

  it("drops pair-channel messages that claim to be from someone else's device", async () => {
    const { hub, channels } = setup();
    hub.setContacts([ADA]);
    await hub.start();
    await tick();
    const got: string[] = [];
    hub.on('transfer-request', (m) => got.push(m.from));
    const pair = channels.get(pairTopic(ME, ADA))!;
    const msg = { to: D.myPhone, transferId: T[0], fromName: 'x', fileCount: 1, totalBytes: 1 };
    pair.broadcast('transfer-request', { ...msg, from: D.adaIphone });
    // Ada pretending to be my own Mac, or an unknown device: ignored.
    pair.broadcast('transfer-request', { ...msg, from: D.myMac });
    pair.broadcast('transfer-request', { ...msg, from: D.stranger });
    expect(got).toEqual([D.adaIphone]);
  });

  it("merges presence: my devices from my channel, only the contact's devices from the pair", async () => {
    const { hub, channels, online, unknown } = setup();
    hub.setContacts([ADA]);
    await hub.start();
    await tick();
    channels.get(`user:${ME}`)!.presence([meta(D.myPhone), meta(D.myMac)]);
    channels
      .get(pairTopic(ME, ADA))!
      .presence([meta(D.myPhone), meta(D.myMac), meta(D.adaIphone), meta(D.adaNewLaptop)]);
    expect([...online().keys()].sort()).toEqual([D.myMac, D.adaIphone]);
    expect(unknown).toContain(ADA); // her new laptop triggers a contacts reload
  });

  it('leaves the pair channel when the contact is removed', async () => {
    const { hub, channels, online } = setup();
    hub.setContacts([ADA]);
    await hub.start();
    await tick();
    channels.get(pairTopic(ME, ADA))!.presence([meta(D.adaIphone)]);
    expect(online().has(D.adaIphone)).toBe(true);
    hub.setContacts([]);
    expect(online().has(D.adaIphone)).toBe(false);
    await expect(
      hub.send('transfer-accept', { to: D.adaIphone, transferId: T[0] }),
    ).rejects.toThrow(/Not connected to that contact/);
  });
});
