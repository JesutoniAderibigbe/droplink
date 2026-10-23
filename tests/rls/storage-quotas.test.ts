import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addDevice,
  addTransfer,
  createUser,
  deleteUser,
  relayParams,
  type TestUser,
} from './helpers';

const MiB = 1024 * 1024;
const blob = (n: number) => new Blob([new Uint8Array(n)], { type: 'application/octet-stream' });

let a: TestUser;
let b: TestUser;
let aPhone: string;
let aMac: string;

/** Start a relay on a fresh transfer and register `objects` relay rows. */
async function relayTransfer(user: TestUser, totalBytes: number) {
  const id = await addTransfer(user, aPhone, aMac, totalBytes);
  const { error } = await user.client
    .from('transfers')
    .update({ relay_params: relayParams })
    .eq('id', id);
  if (error) throw error;
  return id;
}

async function register(
  user: TestUser,
  transferId: string,
  path: string,
  size: number,
  fileIndex = 0,
  chunk = 0,
) {
  return user.client.from('relay_objects').insert({
    transfer_id: transferId,
    user_id: user.id,
    storage_path: `${user.id}/${transferId}/${path}`,
    file_index: fileIndex,
    chunk_index: chunk,
    byte_size: size,
  });
}

beforeAll(async () => {
  [a, b] = await Promise.all([createUser('sa'), createUser('sb')]);
  aPhone = await addDevice(a, 'A phone');
  aMac = await addDevice(a, 'A mac');
});

afterAll(async () => {
  await deleteUser(a);
  await deleteUser(b);
});

describe('relay bucket', () => {
  let transferId: string;
  let path: string;

  beforeAll(async () => {
    transferId = await relayTransfer(a, 100);
    path = `${a.id}/${transferId}/0/0`;
    expect((await register(a, transferId, '0/0', 116)).error).toBeNull();
    expect((await register(a, transferId, 'manifest', 200, -1)).error).toBeNull();
  });

  it('owner can upload a registered object', async () => {
    const { error } = await a.client.storage
      .from('relay')
      .upload(path, blob(116), { contentType: 'application/octet-stream' });
    expect(error).toBeNull();
  });

  it('owner cannot upload an unregistered object (quota bypass)', async () => {
    const { error } = await a.client.storage
      .from('relay')
      .upload(`${a.id}/${transferId}/0/99`, blob(10), { contentType: 'application/octet-stream' });
    expect(error).not.toBeNull();
  });

  it('owner cannot overwrite an object', async () => {
    const { error } = await a.client.storage
      .from('relay')
      .upload(path, blob(10), { contentType: 'application/octet-stream', upsert: true });
    expect(error).not.toBeNull();
  });

  it("B cannot download, list, delete or write into A's folder", async () => {
    const dl = await b.client.storage.from('relay').download(path);
    expect(dl.data).toBeNull();
    const list = await b.client.storage.from('relay').list(`${a.id}/${transferId}/0`);
    expect(list.data ?? []).toHaveLength(0);
    await b.client.storage.from('relay').remove([path]);
    const still = await a.client.storage.from('relay').download(path);
    expect(still.error).toBeNull();
    const up = await b.client.storage
      .from('relay')
      .upload(`${a.id}/${transferId}/0/5`, blob(10), { contentType: 'application/octet-stream' });
    expect(up.error).not.toBeNull();
  });

  it('cannot mark relayed while the manifest is missing, then can once uploaded', async () => {
    const { error: early } = await a.client
      .from('transfers')
      .update({ status: 'relayed' })
      .eq('id', transferId);
    expect(early).not.toBeNull();
    const { error: upErr } = await a.client.storage
      .from('relay')
      .upload(`${a.id}/${transferId}/manifest`, blob(200), {
        contentType: 'application/octet-stream',
      });
    expect(upErr).toBeNull();
    const { error } = await a.client
      .from('transfers')
      .update({ status: 'relayed' })
      .eq('id', transferId);
    expect(error).toBeNull();
  });

  it('rejects an object larger than its declared size', async () => {
    const t = await relayTransfer(a, 1000);
    expect((await register(a, t, '0/0', 10)).error).toBeNull();
    expect((await register(a, t, 'manifest', 10, -1)).error).toBeNull();
    // The uploads themselves succeed (storage can't know the declared size)...
    const up1 = await a.client.storage
      .from('relay')
      .upload(`${a.id}/${t}/0/0`, blob(900), { contentType: 'application/octet-stream' });
    const up2 = await a.client.storage
      .from('relay')
      .upload(`${a.id}/${t}/manifest`, blob(10), { contentType: 'application/octet-stream' });
    expect(up1.error).toBeNull();
    expect(up2.error).toBeNull();
    // ...but the transfer can never become downloadable.
    const { error } = await a.client.from('transfers').update({ status: 'relayed' }).eq('id', t);
    expect(error).not.toBeNull();
  });

  it('bucket rejects objects over the per-object size limit', async () => {
    const t = await relayTransfer(a, 3 * MiB);
    expect((await register(a, t, '0/0', MiB + 1024)).error).toBeNull();
    const { error } = await a.client.storage
      .from('relay')
      .upload(`${a.id}/${t}/0/0`, blob(2 * MiB), { contentType: 'application/octet-stream' });
    expect(error).not.toBeNull();
  });
});

describe('quotas (server side)', () => {
  it('rejects relaying a transfer over 100 MB', async () => {
    const id = await addTransfer(a, aPhone, aMac, 100 * MiB + 1);
    const { error } = await a.client
      .from('transfers')
      .update({ relay_params: relayParams })
      .eq('id', id);
    expect(error?.message).toMatch(/too_large/);
  });

  it('rejects registering more bytes than the transfer declared', async () => {
    const id = await relayTransfer(a, 10);
    expect((await register(a, id, '0/0', 1000)).error).toBeNull(); // within the allowance
    const { error } = await register(a, id, '0/1', MiB + 1024, 0, 1);
    expect(error?.message).toMatch(/too_large/);
  });

  it('rejects relay objects on a transfer that has not started a relay', async () => {
    const id = await addTransfer(a, aPhone, aMac, 10);
    const { error } = await register(a, id, '0/0', 10);
    expect(error).not.toBeNull();
  });

  it('caps relayed transfers per hour', async () => {
    const user = await createUser('rate');
    try {
      const p = await addDevice(user);
      const m = await addDevice(user);
      let lastError = null;
      for (let i = 0; i < 21; i++) {
        const id = await addTransfer(user, p, m, 10);
        lastError = (
          await user.client.from('transfers').update({ relay_params: relayParams }).eq('id', id)
        ).error;
        if (i < 20) expect(lastError, `transfer ${i}`).toBeNull();
      }
      expect(lastError?.message).toMatch(/rate_limited/);
    } finally {
      await deleteUser(user);
    }
  });

  it('caps relay bytes per day at 500 MB', async () => {
    const user = await createUser('daily');
    try {
      const p = await addDevice(user);
      const m = await addDevice(user);
      const objSize = MiB;
      let lastError = null;
      // 5 transfers x 100 objects of 1 MiB = 500 MiB; the next MiB must fail.
      for (let t = 0; t < 6 && !lastError; t++) {
        const id = await addTransfer(user, p, m, 100 * MiB);
        const up = await user.client
          .from('transfers')
          .update({ relay_params: relayParams })
          .eq('id', id);
        expect(up.error).toBeNull();
        const rows = Array.from({ length: t < 5 ? 100 : 1 }, (_, i) => ({
          transfer_id: id,
          user_id: user.id,
          storage_path: `${user.id}/${id}/0/${i}`,
          file_index: 0,
          chunk_index: i,
          byte_size: objSize,
        }));
        lastError = (await user.client.from('relay_objects').insert(rows)).error;
        if (t < 5) expect(lastError, `transfer ${t}`).toBeNull();
      }
      expect(lastError?.message).toMatch(/quota_exceeded/);
      const { data } = await user.client.from('usage_daily').select('relay_bytes').single();
      expect(data!.relay_bytes).toBe(500 * MiB);
    } finally {
      await deleteUser(user);
    }
  });
});
