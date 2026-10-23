import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';
import { createUser, deleteUser, type TestUser } from './helpers';

let a: TestUser;
let b: TestUser;
const channels: [SupabaseClient, RealtimeChannel][] = [];

// A fresh client per join: supabase-js returns the existing channel for a topic
// it already has, and its subscribe callback won't fire a second time.
// `accessToken` matters: without a session supabase-js would push the anon key
// to Realtime right after joining, and the private channel would be closed.
async function join(
  user: TestUser,
  topic: string,
  setup?: (ch: RealtimeChannel) => void,
): Promise<{ status: string; channel: RealtimeChannel }> {
  const client = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
    accessToken: async () => user.accessToken,
  });
  await client.realtime.setAuth();
  const channel = client.channel(topic, { config: { private: true, broadcast: { self: false } } });
  channels.push([client, channel]);
  setup?.(channel);
  return new Promise((resolve) => {
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT')
        resolve({ status, channel });
    });
  });
}

beforeAll(async () => {
  [a, b] = await Promise.all([createUser('rta'), createUser('rtb')]);
});

afterAll(async () => {
  for (const [client, ch] of channels) await client.removeChannel(ch);
  await deleteUser(a);
  await deleteUser(b);
});

describe('realtime authorization', () => {
  it('a user can join their own private channel', async () => {
    const { status } = await join(a, `user:${a.id}`);
    expect(status).toBe('SUBSCRIBED');
  });

  it("another account cannot join someone else's channel", async () => {
    const { status } = await join(b, `user:${a.id}`);
    expect(status).toBe('CHANNEL_ERROR');
  });

  it("another account cannot inject broadcasts into someone else's channel", async () => {
    const received: string[] = [];
    const { status } = await join(a, `user:${a.id}`, (ch) =>
      ch.on('broadcast', { event: 'transfer-request' }, ({ payload }) =>
        received.push(payload.marker),
      ),
    );
    expect(status).toBe('SUBSCRIBED');

    // B can't join A's channel (previous test), so the only way left to send
    // is Realtime's REST broadcast endpoint. It answers 202 either way; what
    // matters is whether the message is delivered.
    await fetch(`${process.env.SUPABASE_URL}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: {
        apikey: process.env.SUPABASE_ANON_KEY!,
        authorization: `Bearer ${b.accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        messages: [
          {
            topic: `user:${a.id}`,
            event: 'transfer-request',
            payload: { marker: 'from-b' },
            private: true,
          },
        ],
      }),
    });

    // Positive control: another connection of the owner does get through, so
    // the listener works and the absence of B's message means it was blocked.
    const { channel: a2, status: s2 } = await join(a, `user:${a.id}`);
    expect(s2).toBe('SUBSCRIBED');
    await a2.send({ type: 'broadcast', event: 'transfer-request', payload: { marker: 'from-a' } });
    await expect.poll(() => received, { timeout: 10_000 }).toContain('from-a');
    expect(received).not.toContain('from-b');
  });
});
