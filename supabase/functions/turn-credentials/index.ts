// Returns ICE servers for WebRTC: Google's public STUN plus short-lived TURN
// credentials from Cloudflare Realtime TURN. The Cloudflare API token never
// leaves the server. Without Cloudflare secrets it returns STUN only (fine on
// most home networks; TURN is needed for strict NATs and some mobile carriers).

import { handler, json, requireUser } from '../_shared/http.ts';

const TTL_SECONDS = 4 * 60 * 60;
const STUN = { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] };

interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

Deno.serve(
  handler(async (req) => {
    await requireUser(req);

    const keyId = Deno.env.get('CLOUDFLARE_TURN_KEY_ID');
    const apiToken = Deno.env.get('CLOUDFLARE_TURN_API_TOKEN');
    if (!keyId || !apiToken)
      return json(req, { iceServers: [STUN], ttl: TTL_SECONDS, turn: false });

    const res = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${apiToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({ ttl: TTL_SECONDS }),
      },
    );
    if (!res.ok) {
      console.error('cloudflare turn error', res.status);
      return json(req, { iceServers: [STUN], ttl: TTL_SECONDS, turn: false });
    }
    const body = (await res.json()) as { iceServers: IceServer[] | IceServer };
    const servers = Array.isArray(body.iceServers) ? body.iceServers : [body.iceServers];

    // Cloudflare also lists port 53 URLs, which browsers block; drop them.
    const cleaned = servers
      .map((s) => ({
        ...s,
        urls: (Array.isArray(s.urls) ? s.urls : [s.urls]).filter((u) => !/:53(\?|$)/.test(u)),
      }))
      .filter((s) => s.urls.length > 0);

    return json(req, { iceServers: [STUN, ...cleaned], ttl: TTL_SECONDS, turn: true });
  }),
);
