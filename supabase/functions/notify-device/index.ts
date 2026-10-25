// Sends a Web Push to a device that isn't online: "Toni's Pixel wants to send
// 3 files, 24 MB". Called by the sender while it waits for the target.
//
// Checks: the caller is signed in (JWT verified with Auth); the transfer and
// the sending device are theirs, and the target device is theirs or an
// accepted contact's (those queries run as the caller, so RLS decides); only
// one push per transfer (claim_transfer_notification). Only then are the
// target's push subscriptions read, with the service key, since they belong
// to the other account when sending to a contact. The payload is built from
// database values, not from the request. Subscriptions that the push service
// reports gone (404/410) are deleted.

import webpush from 'npm:web-push@3.6.7';
import {
  adminClient,
  handler,
  HttpError,
  json,
  readJson,
  requireUser,
  UUID_RE,
} from '../_shared/http.ts';

const publicKey = Deno.env.get('VAPID_PUBLIC_KEY');
const privateKey = Deno.env.get('VAPID_PRIVATE_KEY');
const subject = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@example.com';
if (publicKey && privateKey) webpush.setVapidDetails(subject, publicKey, privateKey);

Deno.serve(
  handler(async (req) => {
    const { user, db } = await requireUser(req);
    if (!publicKey || !privateKey) throw new HttpError(503, 'push_not_configured');

    const { transferId } = await readJson<{ transferId?: string }>(req, 512);
    if (!transferId || !UUID_RE.test(transferId)) throw new HttpError(400, 'invalid_transfer');

    // RLS: only returns the caller's own transfer.
    const { data: t } = await db
      .from('transfers')
      .select('id, from_device_id, to_device_id, file_count, total_bytes, status')
      .eq('id', transferId)
      .maybeSingle();
    if (!t) throw new HttpError(404, 'transfer_not_found');

    // RLS again: the caller's own devices and their contacts' devices are
    // visible, nobody else's. The sending device must be the caller's.
    const { data: devices } = await db
      .from('devices')
      .select('id, user_id, name, revoked_at')
      .in('id', [t.from_device_id, t.to_device_id]);
    const from = devices?.find((d) => d.id === t.from_device_id);
    const to = devices?.find((d) => d.id === t.to_device_id);
    if (!from || !to || from.revoked_at || to.revoked_at || from.user_id !== user.id)
      throw new HttpError(403, 'device_not_allowed');

    // To your own device it's "Pixel 9 wants to send…"; to someone else it's
    // your name.
    let fromName = String(from.name);
    if (to.user_id !== user.id) {
      const { data: me } = await db
        .from('profiles')
        .select('display_name')
        .eq('id', user.id)
        .maybeSingle();
      fromName = me?.display_name?.trim() || 'Someone';
    }

    const { data: claimed, error: claimError } = await db.rpc('claim_transfer_notification', {
      p_transfer_id: transferId,
    });
    if (claimError) throw new HttpError(500, 'claim_failed');
    if (!claimed) return json(req, { sent: 0, skipped: 'already_notified_or_not_pending' });

    const admin = adminClient();
    const { data: subs } = await admin
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth')
      .eq('device_id', to.id);

    const payload = JSON.stringify({
      v: 1,
      type: 'incoming',
      transferId: t.id,
      fromName: fromName.slice(0, 60),
      fileCount: t.file_count,
      totalBytes: t.total_bytes,
    });

    let sent = 0;
    const gone: string[] = [];
    await Promise.all(
      (subs ?? []).map(async (s) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            payload,
            {
              TTL: 120, // seconds: after that, the relay takes over anyway
              urgency: 'high',
              topic: t.id.replace(/-/g, '').slice(0, 32),
            },
          );
          sent++;
        } catch (e) {
          const status = (e as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) gone.push(s.id);
          else
            console.error(
              'push failed',
              status ?? (e as { code?: string }).code ?? (e as Error).name,
            ); // no endpoint: it's a capability URL
        }
      }),
    );
    if (gone.length) await admin.from('push_subscriptions').delete().in('id', gone);

    return json(req, { sent, removed: gone.length });
  }),
);
