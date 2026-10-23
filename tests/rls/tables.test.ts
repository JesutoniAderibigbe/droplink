import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addDevice,
  addTransfer,
  admin,
  createUser,
  deleteUser,
  fakePublicJwk,
  type TestUser,
} from './helpers';

// Each test proves one thing: user B cannot see or change user A's rows, and
// user A can't sidestep the column/ownership rules on their own rows.

let a: TestUser;
let b: TestUser;
let aPhone: string;
let aMac: string;
let bLaptop: string;
let aTransfer: string;

beforeAll(async () => {
  [a, b] = await Promise.all([createUser('a'), createUser('b')]);
  aPhone = await addDevice(a, 'A phone');
  aMac = await addDevice(a, 'A mac');
  bLaptop = await addDevice(b, 'B laptop');
  aTransfer = await addTransfer(a, aPhone, aMac);
  const { error } = await admin.from('push_subscriptions').insert({
    device_id: aMac,
    endpoint: `https://push.example/${crypto.randomUUID()}`,
    p256dh: 'k',
    auth: 'a',
  });
  if (error) throw error;
});

afterAll(async () => {
  await deleteUser(a);
  await deleteUser(b);
});

describe('anon', () => {
  it('cannot read any table', async () => {
    const anon = (await import('@supabase/supabase-js')).createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_ANON_KEY!,
      { auth: { persistSession: false } },
    );
    for (const table of [
      'profiles',
      'devices',
      'push_subscriptions',
      'transfers',
      'relay_objects',
      'usage_daily',
    ]) {
      const { data, error } = await anon.from(table).select('*');
      // Either permission denied or an empty result; never rows.
      expect(error?.code === '42501' || (data ?? []).length === 0, table).toBe(true);
    }
  });
});

describe('profiles', () => {
  it('is created automatically on sign up', async () => {
    const { data } = await a.client.from('profiles').select('*');
    expect(data).toHaveLength(1);
    expect(data![0].id).toBe(a.id);
  });

  it("B cannot read or update A's profile", async () => {
    const { data } = await b.client.from('profiles').select('*').eq('id', a.id);
    expect(data).toHaveLength(0);
    await b.client.from('profiles').update({ display_name: 'pwned' }).eq('id', a.id);
    const { data: check } = await admin
      .from('profiles')
      .select('display_name')
      .eq('id', a.id)
      .single();
    expect(check!.display_name).not.toBe('pwned');
  });
});

describe('devices', () => {
  it('each user only sees their own devices', async () => {
    const { data: mine } = await a.client.from('devices').select('id');
    expect(mine!.map((d) => d.id).sort()).toEqual([aPhone, aMac].sort());
    const { data: theirs } = await b.client.from('devices').select('id');
    expect(theirs!.map((d) => d.id)).toEqual([bLaptop]);
  });

  it('B cannot register a device for A', async () => {
    const { error } = await b.client
      .from('devices')
      .insert({ user_id: a.id, name: 'evil', kind: 'other', public_key: await fakePublicJwk() });
    expect(error).not.toBeNull();
  });

  it("B cannot rename or revoke A's device", async () => {
    await b.client.from('devices').update({ name: 'evil' }).eq('id', aPhone);
    await b.client
      .from('devices')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', aPhone);
    const { data } = await admin
      .from('devices')
      .select('name, revoked_at')
      .eq('id', aPhone)
      .single();
    expect(data).toEqual({ name: 'A phone', revoked_at: null });
  });

  it('cannot move a device to another user or replace its key', async () => {
    const { error: e1 } = await a.client.from('devices').update({ user_id: b.id }).eq('id', aPhone);
    expect(e1).not.toBeNull();
    const { error: e2 } = await a.client
      .from('devices')
      .update({ public_key: await fakePublicJwk() })
      .eq('id', aPhone);
    expect(e2).not.toBeNull();
  });

  it('rejects a private key in public_key', async () => {
    const kp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
      'deriveBits',
    ]);
    const priv = await crypto.subtle.exportKey('jwk', kp.privateKey);
    const { error } = await a.client
      .from('devices')
      .insert({ user_id: a.id, name: 'leaky', kind: 'other', public_key: priv });
    expect(error).not.toBeNull();
  });

  it('revoking removes push subscriptions and is permanent', async () => {
    const dev = await addDevice(a, 'to revoke');
    await admin.from('push_subscriptions').insert({
      device_id: dev,
      endpoint: `https://push.example/${crypto.randomUUID()}`,
      p256dh: 'k',
      auth: 'a',
    });
    const { error } = await a.client
      .from('devices')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', dev);
    expect(error).toBeNull();
    const { data: subs } = await admin.from('push_subscriptions').select('id').eq('device_id', dev);
    expect(subs).toHaveLength(0);
    const { error: undo } = await a.client
      .from('devices')
      .update({ revoked_at: null })
      .eq('id', dev);
    expect(undo).not.toBeNull();
  });
});

describe('push_subscriptions', () => {
  it('owner sees their subscriptions; B does not', async () => {
    const { data: mine } = await a.client.from('push_subscriptions').select('device_id');
    expect(mine!.map((s) => s.device_id)).toContain(aMac);
    const { data: theirs } = await b.client.from('push_subscriptions').select('*');
    expect(theirs).toHaveLength(0);
  });

  it("B cannot subscribe A's device or delete A's subscription", async () => {
    const { error } = await b.client.from('push_subscriptions').insert({
      device_id: aMac,
      endpoint: `https://push.example/${crypto.randomUUID()}`,
      p256dh: 'k',
      auth: 'a',
    });
    expect(error).not.toBeNull();
    await b.client.from('push_subscriptions').delete().eq('device_id', aMac);
    const { data } = await admin.from('push_subscriptions').select('id').eq('device_id', aMac);
    expect(data!.length).toBeGreaterThan(0);
  });
});

describe('transfers', () => {
  it("B cannot read A's transfers", async () => {
    const { data } = await b.client.from('transfers').select('*');
    expect(data).toHaveLength(0);
  });

  it("B cannot create a transfer involving A's devices", async () => {
    const { error } = await b.client.from('transfers').insert({
      user_id: b.id,
      from_device_id: bLaptop,
      to_device_id: aMac,
      file_count: 1,
      total_bytes: 1,
    });
    expect(error).not.toBeNull();
  });

  it("B cannot change A's transfer", async () => {
    await b.client.from('transfers').update({ status: 'cancelled' }).eq('id', aTransfer);
    const { data } = await admin.from('transfers').select('status').eq('id', aTransfer).single();
    expect(data!.status).toBe('pending');
  });

  it('owner cannot extend expiry or jump to an invalid status', async () => {
    const { error: e1 } = await a.client
      .from('transfers')
      .update({ expires_at: '2999-01-01' })
      .eq('id', aTransfer);
    expect(e1).not.toBeNull();
    const { error: e2 } = await a.client
      .from('transfers')
      .update({ status: 'expired' })
      .eq('id', aTransfer);
    expect(e2).not.toBeNull();
  });

  it('cannot go to relayed without an uploaded relay', async () => {
    const t = await addTransfer(a, aPhone, aMac);
    const { error } = await a.client.from('transfers').update({ status: 'relayed' }).eq('id', t);
    expect(error).not.toBeNull();
  });

  it('server forces status and expiry on insert', async () => {
    const { data, error } = await a.client
      .from('transfers')
      .insert({
        user_id: a.id,
        from_device_id: aPhone,
        to_device_id: aMac,
        file_count: 1,
        total_bytes: 1,
        status: 'delivered',
        expires_at: '2999-01-01',
      })
      .select('status, expires_at')
      .single();
    // Either the column isn't insertable, or the trigger overrode it.
    if (!error) {
      expect(data!.status).toBe('pending');
      expect(new Date(data!.expires_at).getTime()).toBeLessThan(Date.now() + 25 * 3600_000);
    }
  });
});

describe('relay_objects and usage_daily', () => {
  it("B cannot register relay objects in A's transfer", async () => {
    const { error } = await b.client.from('relay_objects').insert({
      transfer_id: aTransfer,
      user_id: b.id,
      storage_path: `${b.id}/${aTransfer}/0/0`,
      file_index: 0,
      chunk_index: 0,
      byte_size: 10,
    });
    expect(error).not.toBeNull();
  });

  it('usage_daily is readable by its owner only and not writable', async () => {
    const { data: mine } = await a.client.from('usage_daily').select('*');
    expect(mine!.length).toBe(1);
    expect(mine![0].transfer_count).toBeGreaterThan(0);
    const { data: theirs } = await b.client.from('usage_daily').select('*').eq('user_id', a.id);
    expect(theirs).toHaveLength(0);
    const { error } = await a.client
      .from('usage_daily')
      .update({ relay_bytes: 0 })
      .eq('user_id', a.id);
    expect(error).not.toBeNull();
  });
});
