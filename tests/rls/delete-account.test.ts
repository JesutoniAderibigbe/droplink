import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addDevice,
  addTransfer,
  admin,
  createUser,
  deleteUser,
  relayParams,
  type TestUser,
} from './helpers';

// Requires `npm run functions:serve`.
const call = (token: string | null, body: unknown) =>
  fetch(`${process.env.SUPABASE_URL}/functions/v1/delete-account`, {
    method: 'POST',
    headers: {
      apikey: process.env.SUPABASE_ANON_KEY!,
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });

let a: TestUser;
let b: TestUser;
let bDevice: string;

beforeAll(async () => {
  [a, b] = await Promise.all([createUser('del-a'), createUser('del-b')]);
  bDevice = await addDevice(b);
});

afterAll(async () => {
  await deleteUser(b);
});

describe('delete-account', () => {
  it('requires a signed-in user and explicit confirmation', async () => {
    expect((await call(null, { confirm: 'DELETE' })).status).toBe(401);
    expect((await call(a.accessToken, {})).status).toBe(400);
  });

  it("deletes the caller's rows and relay objects, and nobody else's", async () => {
    const p = await addDevice(a);
    const m = await addDevice(a);
    const t = await addTransfer(a, p, m, 100);
    await a.client.from('transfers').update({ relay_params: relayParams }).eq('id', t);
    const path = `${a.id}/${t}/0/0`;
    await a.client
      .from('relay_objects')
      .insert({
        transfer_id: t,
        user_id: a.id,
        storage_path: path,
        file_index: 0,
        chunk_index: 0,
        byte_size: 116,
      });
    const up = await a.client.storage
      .from('relay')
      .upload(path, new Blob([new Uint8Array(116)]), { contentType: 'application/octet-stream' });
    expect(up.error).toBeNull();

    const res = await call(a.accessToken, { confirm: 'DELETE' });
    expect(res.status).toBe(200);

    expect((await admin.auth.admin.getUserById(a.id)).data.user).toBeNull();
    for (const table of ['profiles', 'devices', 'transfers', 'relay_objects', 'usage_daily']) {
      const col = table === 'profiles' ? 'id' : 'user_id';
      const { data } = await admin.from(table).select('*').eq(col, a.id);
      expect(data, table).toEqual([]);
    }
    const { data: objects } = await admin.storage.from('relay').list(`${a.id}/${t}/0`);
    expect(objects ?? []).toEqual([]);

    // B untouched.
    const { data: bDevices } = await admin.from('devices').select('id').eq('user_id', b.id);
    expect(bDevices!.map((d) => d.id)).toEqual([bDevice]);
  });
});
