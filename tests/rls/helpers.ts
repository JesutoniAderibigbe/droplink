import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL!;
const anonKey = process.env.SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export interface TestUser {
  id: string;
  email: string;
  client: SupabaseClient;
  accessToken: string;
}

/** Create a confirmed user and return a client signed in as them. */
export async function createUser(label: string): Promise<TestUser> {
  const email = `${label}-${crypto.randomUUID().slice(0, 8)}@droplink.test`;
  const password = `pw-${crypto.randomUUID()}`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw error;
  const client = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: signIn, error: signInError } = await client.auth.signInWithPassword({
    email,
    password,
  });
  if (signInError) throw signInError;
  return { id: data.user.id, email, client, accessToken: signIn.session!.access_token };
}

export async function deleteUser(user: TestUser | undefined): Promise<void> {
  if (!user) return;
  // Storage objects aren't removed by the auth cascade.
  const { data } = await admin.from('relay_objects').select('storage_path').eq('user_id', user.id);
  if (data?.length) await admin.storage.from('relay').remove(data.map((r) => r.storage_path));
  await admin.auth.admin.deleteUser(user.id);
}

export async function fakePublicJwk(): Promise<JsonWebKey> {
  const kp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ]);
  const jwk = await crypto.subtle.exportKey('jwk', kp.publicKey);
  return { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y };
}

export async function addDevice(user: TestUser, name = 'Test device'): Promise<string> {
  const id = crypto.randomUUID();
  const { error } = await user.client
    .from('devices')
    .insert({ id, user_id: user.id, name, kind: 'other', public_key: await fakePublicJwk() });
  if (error) throw error;
  return id;
}

export async function addTransfer(
  user: TestUser,
  from: string,
  to: string,
  totalBytes = 1000,
  fileCount = 1,
): Promise<string> {
  const { data, error } = await user.client
    .from('transfers')
    .insert({
      user_id: user.id,
      from_device_id: from,
      to_device_id: to,
      file_count: fileCount,
      total_bytes: totalBytes,
    })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

export const relayParams = { v: 1, epk: { kty: 'EC' }, salt: 'AAAA', ivPrefix: 'AAAA' };
