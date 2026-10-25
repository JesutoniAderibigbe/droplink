import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';
import {
  addDevice,
  addTransfer,
  admin,
  createUser,
  deleteUser,
  relayParams,
  type TestUser,
} from './helpers';

// a and b become contacts; c is a stranger to both.
let a: TestUser;
let b: TestUser;
let c: TestUser;
let aPhone: string;
let bIphone: string;
let cLaptop: string;

const pairTopic = (x: string, y: string) => `pair:${[x, y].sort().join(':')}`;

beforeAll(async () => {
  [a, b, c] = await Promise.all([createUser('ca'), createUser('cb'), createUser('cc')]);
  [aPhone, bIphone, cLaptop] = await Promise.all([
    addDevice(a, 'A Pixel'),
    addDevice(b, 'B iPhone'),
    addDevice(c, 'C laptop'),
  ]);
});

afterAll(async () => {
  await Promise.all([deleteUser(a), deleteUser(b), deleteUser(c)]);
});

describe('before they are contacts', () => {
  it("can't see the other person's devices", async () => {
    const { data } = await a.client.from('devices').select('id').eq('id', bIphone);
    expect(data).toEqual([]);
  });

  it("can't create a transfer to the other person's device", async () => {
    await expect(addTransfer(a, aPhone, bIphone)).rejects.toMatchObject({ code: '42501' });
  });

  it('a request by email is pending until accepted', async () => {
    const { data } = await a.client.rpc('request_contact', { p_email: b.email.toUpperCase() });
    expect(data).toBe('requested');
    // Still not contacts.
    await expect(addTransfer(a, aPhone, bIphone)).rejects.toMatchObject({ code: '42501' });

    const { data: mine } = await b.client.rpc('my_contacts');
    expect(mine).toEqual([
      expect.objectContaining({ user_id: a.id, status: 'pending', incoming: true, email: a.email }),
    ]);
  });

  it('unknown emails and your own email are reported', async () => {
    expect((await a.client.rpc('request_contact', { p_email: 'nobody@droplink.test' })).data).toBe(
      'not_found',
    );
    expect((await a.client.rpc('request_contact', { p_email: a.email })).data).toBe('self');
  });

  it("the requester can't accept their own request", async () => {
    const { error } = await a.client.rpc('respond_contact', { p_other: b.id, p_accept: true });
    expect(error?.code).toBe('PT404');
  });

  it('contacts and invites are not directly readable or writable', async () => {
    expect((await a.client.from('contacts').select('*')).error?.code).toBe('42501');
    expect((await a.client.from('contact_invites').select('*')).error?.code).toBe('42501');
    const { error } = await c.client
      .from('contacts')
      .insert({ user_a: c.id, user_b: a.id, requested_by: c.id, status: 'accepted' });
    expect(error?.code).toBe('42501');
  });
});

describe('once accepted', () => {
  beforeAll(async () => {
    const { error } = await b.client.rpc('respond_contact', { p_other: a.id, p_accept: true });
    if (error) throw error;
  });

  it('both see each other as contacts, without emails', async () => {
    const { data } = await a.client.rpc('my_contacts');
    expect(data).toEqual([
      expect.objectContaining({ user_id: b.id, status: 'accepted', email: null }),
    ]);
  });

  it("each can read the other's devices (with the public key), but not change them", async () => {
    const { data } = await a.client.from('devices').select('id, public_key').eq('id', bIphone);
    expect(data).toHaveLength(1);
    expect(data![0].public_key).toMatchObject({ kty: 'EC', crv: 'P-256' });
    const { data: changed } = await a.client
      .from('devices')
      .update({ name: 'hacked' })
      .eq('id', bIphone)
      .select('id');
    expect(changed).toEqual([]);
  });

  it("strangers still see nothing, and can't send", async () => {
    const { data } = await c.client.from('devices').select('id').in('id', [aPhone, bIphone]);
    expect(data).toEqual([]);
    await expect(addTransfer(c, cLaptop, aPhone)).rejects.toMatchObject({ code: '42501' });
  });

  it("can't send from someone else's device", async () => {
    await expect(addTransfer(a, bIphone, aPhone)).rejects.toMatchObject({ code: '42501' });
  });

  describe('a relayed transfer from a to b', () => {
    let transferId: string;
    let path: string;

    beforeAll(async () => {
      transferId = await addTransfer(a, aPhone, bIphone, 10);
      let { error } = await a.client
        .from('transfers')
        .update({ relay_params: relayParams })
        .eq('id', transferId);
      if (error) throw error;
      path = `${a.id}/${transferId}/manifest`;
      ({ error } = await a.client.from('relay_objects').insert({
        transfer_id: transferId,
        user_id: a.id,
        storage_path: path,
        file_index: -1,
        chunk_index: 0,
        byte_size: 32,
      }));
      if (error) throw error;
      const { error: uploadError } = await a.client.storage
        .from('relay')
        .upload(path, new Blob([new Uint8Array(32)], { type: 'application/octet-stream' }), {
          contentType: 'application/octet-stream',
        });
      if (uploadError) throw uploadError;
      ({ error } = await a.client
        .from('transfers')
        .update({ status: 'relayed' })
        .eq('id', transferId));
      if (error) throw error;
    });

    it('the receiver can read the transfer and download the relay object', async () => {
      const { data: row } = await b.client
        .from('transfers')
        .select('id, status')
        .eq('id', transferId)
        .single();
      expect(row?.status).toBe('relayed');
      const { data: objs } = await b.client
        .from('relay_objects')
        .select('storage_path')
        .eq('transfer_id', transferId);
      expect(objs).toEqual([{ storage_path: path }]);
      const { data: file, error } = await b.client.storage.from('relay').download(path);
      expect(error).toBeNull();
      expect(file?.size).toBe(32);
    });

    it('a stranger can do none of that', async () => {
      expect((await c.client.from('transfers').select('id').eq('id', transferId)).data).toEqual([]);
      const { data, error } = await c.client.storage.from('relay').download(path);
      expect(data).toBeNull();
      expect(error).toBeTruthy();
    });

    it("the receiver can't restart the relay or rewrite the status freely", async () => {
      const { error } = await b.client
        .from('transfers')
        .update({ relay_params: { ...relayParams, salt: 'BBBB' } })
        .eq('id', transferId);
      expect(error?.code).toBe('42501');
      const { error: e2 } = await b.client
        .from('transfers')
        .update({ status: 'cancelled' })
        .eq('id', transferId);
      expect(e2?.code).toBe('42501');
    });

    it('the receiver marks it delivered and deletes the relay copy', async () => {
      const { error } = await b.client
        .from('transfers')
        .update({ status: 'delivered' })
        .eq('id', transferId);
      expect(error).toBeNull();
      const { error: rmError } = await b.client.storage.from('relay').remove([path]);
      expect(rmError).toBeNull();
      await b.client.from('relay_objects').delete().eq('transfer_id', transferId);
      const { data: left } = await admin
        .from('relay_objects')
        .select('storage_path')
        .eq('transfer_id', transferId);
      expect(left).toEqual([]);
      const { data: listed } = await admin.storage.from('relay').list(`${a.id}/${transferId}`);
      expect(listed).toEqual([]);
    });
  });

  it('quotas still count against the sender', async () => {
    const { data } = await admin.from('usage_daily').select('transfer_count').eq('user_id', a.id);
    expect(data?.[0]?.transfer_count).toBeGreaterThan(0);
    const { data: bUsage } = await admin.from('usage_daily').select('*').eq('user_id', b.id);
    expect(bUsage).toEqual([]);
  });
});

describe('invites (QR code / link)', () => {
  let d: TestUser;
  beforeAll(async () => {
    d = await createUser('cd');
  });
  afterAll(async () => deleteUser(d));

  it('opening an invite makes you contacts immediately, once', async () => {
    const { data: inv, error } = await c.client.rpc('create_contact_invite');
    expect(error).toBeNull();
    const token = inv[0].token as string;
    expect(token).toMatch(/^[0-9a-f]{36}$/);

    const { data: inviter, error: e2 } = await d.client.rpc('accept_contact_invite', {
      p_token: token,
    });
    expect(e2).toBeNull();
    expect(inviter[0].user_id).toBe(c.id);
    expect((await d.client.from('devices').select('id').eq('id', cLaptop)).data).toHaveLength(1);

    // One-time: a second person can't reuse it.
    const { error: again } = await a.client.rpc('accept_contact_invite', { p_token: token });
    expect(again?.code).toBe('PT404');
  });

  it("you can't accept your own invite, and junk tokens are rejected", async () => {
    const { data: inv } = await d.client.rpc('create_contact_invite');
    const { error } = await d.client.rpc('accept_contact_invite', { p_token: inv[0].token });
    expect(error?.code).toBe('PT409');
    const { error: junk } = await d.client.rpc('accept_contact_invite', { p_token: "x' or 1=1" });
    expect(junk?.code).toBe('PT404');
  });

  it('expired invites are rejected', async () => {
    const { data: inv } = await c.client.rpc('create_contact_invite');
    await admin
      .from('contact_invites')
      .update({ expires_at: new Date(Date.now() - 1000).toISOString() })
      .eq('user_id', c.id)
      .is('used_at', null);
    const { error } = await a.client.rpc('accept_contact_invite', { p_token: inv[0].token });
    expect(error?.code).toBe('PT404');
  });
});

describe('pair channel', () => {
  const channels: [SupabaseClient, RealtimeChannel][] = [];
  afterAll(async () => {
    for (const [client, ch] of channels) await client.removeChannel(ch);
  });

  async function join(user: TestUser, topic: string): Promise<string> {
    const client = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
      accessToken: async () => user.accessToken,
    });
    await client.realtime.setAuth();
    const channel = client.channel(topic, { config: { private: true } });
    channels.push([client, channel]);
    return new Promise((resolve) => {
      channel.subscribe((status) => {
        if (status === 'SUBSCRIBED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT')
          resolve(status);
      });
    });
  }

  it('contacts can join their pair channel', async () => {
    expect(await join(a, pairTopic(a.id, b.id))).toBe('SUBSCRIBED');
    expect(await join(b, pairTopic(a.id, b.id))).toBe('SUBSCRIBED');
  });

  it("a stranger can't join it, and non-contacts have no pair channel", async () => {
    expect(await join(c, pairTopic(a.id, b.id))).toBe('CHANNEL_ERROR');
    expect(await join(a, pairTopic(a.id, c.id))).toBe('CHANNEL_ERROR');
  });

  it('removing the contact closes the door again', async () => {
    const { error } = await a.client.rpc('remove_contact', { p_other: b.id });
    expect(error).toBeNull();
    expect(await join(a, pairTopic(a.id, b.id))).toBe('CHANNEL_ERROR');
    expect((await a.client.from('devices').select('id').eq('id', bIphone)).data).toEqual([]);
    await expect(addTransfer(a, aPhone, bIphone)).rejects.toMatchObject({ code: '42501' });
  });
});
