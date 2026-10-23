-- Web Push support.

-- Save (or move) a push subscription for one of the caller's active devices.
-- Push endpoints identify a browser profile, so the same endpoint can come
-- back from a different device row (re-registered device, or another account
-- signed in on the same browser). The newest owner wins: the old row is
-- replaced, so pushes never go to an account that no longer uses this browser.
create function public.save_push_subscription(
  p_device_id uuid,
  p_endpoint text,
  p_p256dh text,
  p_auth text
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.owns_device(p_device_id) then
    raise exception 'not your device' using errcode = '42501';
  end if;
  if p_endpoint !~ '^https://' or char_length(p_endpoint) > 1024
     or char_length(p_p256dh) > 256 or char_length(p_auth) > 64 then
    raise exception 'invalid subscription' using errcode = '22023';
  end if;
  -- At most 5 subscriptions per device (stale ones are pruned on 404/410).
  delete from public.push_subscriptions where endpoint = p_endpoint;
  insert into public.push_subscriptions (device_id, endpoint, p256dh, auth)
  values (p_device_id, p_endpoint, p_p256dh, p_auth);
  delete from public.push_subscriptions
  where device_id = p_device_id
    and id not in (
      select id from public.push_subscriptions where device_id = p_device_id
      order by created_at desc limit 5
    );
end $$;
revoke all on function public.save_push_subscription(uuid, text, text, text) from public, anon;
grant execute on function public.save_push_subscription(uuid, text, text, text) to authenticated;

-- One push per transfer. notify-device calls this (as the user) before sending;
-- it returns false if the transfer isn't the caller's, isn't pending, is too
-- old, or was already notified, so the function can't be used to spam.
alter table public.transfers add column notified_at timestamptz;

create function public.claim_transfer_notification(p_transfer_id uuid)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  claimed uuid;
begin
  update public.transfers
     set notified_at = now()
   where id = p_transfer_id
     and user_id = (select auth.uid())
     and status = 'pending'
     and notified_at is null
     and created_at > now() - interval '10 minutes'
  returning id into claimed;
  return claimed is not null;
end $$;
revoke all on function public.claim_transfer_notification(uuid) from public, anon;
grant execute on function public.claim_transfer_notification(uuid) to authenticated;
