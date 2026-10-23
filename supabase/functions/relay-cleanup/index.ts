// Hourly relay cleanup, called by pg_cron (see migrations/*_cron.sql).
//
// Deletes Storage objects and relay_objects rows for:
//   - transfers past expires_at (24 h) that are still pending/p2p/relayed -> marked "expired"
//   - finished transfers (delivered/failed/cancelled) that still have relay objects
//   - relay uploads abandoned for over 2 hours (never reached "relayed", e.g. the
//     sender closed the app mid-upload, or the sizes didn't match) -> "failed"
// Storage objects can't be deleted with SQL, hence a function with the
// service role. Authenticated with a shared secret (CRON_SECRET), not a user JWT.

import { adminClient, handler, HttpError, json } from '../_shared/http.ts';

const BUCKET = 'relay';
const cronSecret = Deno.env.get('CRON_SECRET');

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(
  handler(async (req) => {
    const given = req.headers.get('x-cron-secret') ?? '';
    if (!cronSecret || !timingSafeEqual(given, cronSecret))
      throw new HttpError(401, 'unauthorized');

    const db = adminClient();
    const now = new Date();
    const abandonedBefore = new Date(now.getTime() - 2 * 3600_000).toISOString();

    const [expired, finished, abandoned] = await Promise.all([
      db
        .from('transfers')
        .select('id')
        .in('status', ['pending', 'p2p', 'relayed'])
        .lt('expires_at', now.toISOString())
        .limit(1000),
      db
        .from('transfers')
        .select('id, relay_objects!inner(transfer_id)')
        .in('status', ['delivered', 'failed', 'cancelled', 'expired'])
        .limit(1000),
      db
        .from('transfers')
        .select('id')
        .eq('status', 'pending')
        .not('relay_started_at', 'is', null)
        .lt('relay_started_at', abandonedBefore)
        .limit(1000),
    ]);
    for (const r of [expired, finished, abandoned])
      if (r.error) throw new HttpError(500, 'query_failed');

    const ids = [
      ...new Set([...expired.data!, ...finished.data!, ...abandoned.data!].map((t) => t.id)),
    ];
    let objects = 0;
    for (let i = 0; i < ids.length; i += 100) {
      const batch = ids.slice(i, i + 100);
      const { data: rows } = await db
        .from('relay_objects')
        .select('storage_path')
        .in('transfer_id', batch);
      const paths = (rows ?? []).map((r) => r.storage_path);
      for (let j = 0; j < paths.length; j += 1000) {
        const { error } = await db.storage.from(BUCKET).remove(paths.slice(j, j + 1000));
        if (error) throw new HttpError(500, 'storage_delete_failed');
      }
      await db.from('relay_objects').delete().in('transfer_id', batch);
      objects += paths.length;
    }

    if (expired.data!.length) {
      await db
        .from('transfers')
        .update({ status: 'expired' })
        .in(
          'id',
          expired.data!.map((t) => t.id),
        );
    }
    const abandonedIds = abandoned
      .data!.map((t) => t.id)
      .filter((id) => !expired.data!.some((e) => e.id === id));
    if (abandonedIds.length)
      await db.from('transfers').update({ status: 'failed' }).in('id', abandonedIds);

    // Counts only: never log names, paths or ids of user content.
    console.log(
      `relay-cleanup: ${expired.data!.length} expired, ${abandonedIds.length} abandoned, ${objects} objects deleted`,
    );
    return json(req, { expired: expired.data!.length, abandoned: abandonedIds.length, objects });
  }),
);
