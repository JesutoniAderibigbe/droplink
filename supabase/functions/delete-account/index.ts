// Permanently deletes the caller's account: relay objects in Storage first
// (Storage isn't covered by foreign keys), then the auth user, which cascades
// to profiles, devices, push_subscriptions, transfers, relay_objects and
// usage_daily. Only ever acts on the user identified by the verified JWT.

import { adminClient, handler, HttpError, json, readJson, requireUser } from '../_shared/http.ts';

Deno.serve(
  handler(async (req) => {
    const { user } = await requireUser(req);
    const { confirm } = await readJson<{ confirm?: string }>(req, 256);
    if (confirm !== 'DELETE') throw new HttpError(400, 'confirmation_required');

    const admin = adminClient();

    // Every relay object is registered in relay_objects (the Storage policy
    // requires it), so this finds them all. Also sweep the user's folder in
    // case a registration row was removed without its object.
    const { data: rows, error } = await admin
      .from('relay_objects')
      .select('storage_path')
      .eq('user_id', user.id);
    if (error) throw new HttpError(500, 'lookup_failed');
    const paths = new Set((rows ?? []).map((r) => r.storage_path));
    const { data: transfers } = await admin.from('transfers').select('id').eq('user_id', user.id);
    for (const t of transfers ?? []) {
      const { data: top } = await admin.storage
        .from('relay')
        .list(`${user.id}/${t.id}`, { limit: 1000 });
      for (const entry of top ?? []) {
        if (entry.id) paths.add(`${user.id}/${t.id}/${entry.name}`);
        else {
          const { data: inner } = await admin.storage
            .from('relay')
            .list(`${user.id}/${t.id}/${entry.name}`, { limit: 1000 });
          for (const f of inner ?? []) paths.add(`${user.id}/${t.id}/${entry.name}/${f.name}`);
        }
      }
    }
    const list = [...paths];
    for (let i = 0; i < list.length; i += 1000) {
      const { error: rmError } = await admin.storage.from('relay').remove(list.slice(i, i + 1000));
      if (rmError) throw new HttpError(500, 'storage_delete_failed');
    }

    const { error: delError } = await admin.auth.admin.deleteUser(user.id);
    if (delError) throw new HttpError(500, 'delete_failed');

    console.log(`delete-account: removed 1 account, ${list.length} relay objects`);
    return json(req, { deleted: true });
  }),
);
