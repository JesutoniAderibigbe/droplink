-- People: sending to someone else's devices.
--
-- Two accounts become contacts either by request (A types B's email, B
-- accepts) or by a one-time invite (A shows a QR code or link, B opens it:
-- showing it is A's consent, opening it is B's). Once accepted:
--   - each can see the other's active devices (name, kind, public key), so the
--     sender can encrypt relay uploads to the receiver's device;
--   - each can create transfers addressed to the other's devices;
--   - the receiver can read those transfers, their relay objects and Storage
--     files, and mark a relayed transfer delivered or failed. Nothing else;
--   - both can join the private Realtime channel "pair:{a}:{b}" (a < b) for
--     presence and signaling between their devices.
-- Quotas stay with the sender's account, as before.

create function private.limit_contacts() returns int
  language sql immutable as $$ select 50 $$;
create function private.limit_contact_requests_per_hour() returns int
  language sql immutable as $$ select 20 $$;
create function private.limit_invites_per_hour() returns int
  language sql immutable as $$ select 30 $$;

create table public.contacts (
  -- One row per pair, stored in a fixed order so (A, B) and (B, A) collide.
  user_a uuid not null references auth.users (id) on delete cascade,
  user_b uuid not null references auth.users (id) on delete cascade,
  requested_by uuid not null references auth.users (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  primary key (user_a, user_b),
  check (user_a < user_b),
  check (requested_by in (user_a, user_b))
);
create index contacts_user_b_idx on public.contacts (user_b);
create index contacts_requested_by_idx on public.contacts (requested_by, created_at);

create table public.contact_invites (
  -- sha256 of the token; the token itself only exists in the QR code / link.
  token_hash bytea primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 minutes',
  used_at timestamptz
);
create index contact_invites_user_idx on public.contact_invites (user_id, created_at);

revoke all on public.contacts, public.contact_invites from anon, authenticated;
-- Contacts are read through my_contacts() and changed only through the RPCs
-- below; invites are never readable.
alter table public.contacts enable row level security;
alter table public.contact_invites enable row level security;

-- ---------------------------------------------------------------------------
-- Helpers (security definer: used inside policies on other tables)
-- ---------------------------------------------------------------------------
create function private.is_contact(p_other uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.contacts c
    where c.status = 'accepted'
      and c.user_a = least(p_other, (select auth.uid()))
      and c.user_b = greatest(p_other, (select auth.uid()))
  )
$$;

-- An active device of mine or of an accepted contact.
create function private.can_send_to_device(p_device_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.devices d
    where d.id = p_device_id
      and d.revoked_at is null
      and (d.user_id = (select auth.uid()) or private.is_contact(d.user_id))
  )
$$;

-- Is this transfer addressed to one of my devices?
create function private.is_recipient(p_transfer_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.transfers t
    join public.devices d on d.id = t.to_device_id
    where t.id = p_transfer_id and d.user_id = (select auth.uid())
  )
$$;

-- Storage object in the relay bucket that belongs to a transfer sent to me.
create function private.is_relay_object_for_me(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.relay_objects r
    where r.storage_path = p_name and private.is_recipient(r.transfer_id)
  )
$$;

-- Realtime topic "pair:{a}:{b}" with a < b, me one of them, and accepted.
create function private.can_join_pair(p_topic text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  uuid_re constant text := '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
  parts text[];
  a uuid;
  b uuid;
  me uuid := (select auth.uid());
begin
  if me is null or p_topic !~ ('^pair:' || uuid_re || ':' || uuid_re || '$') then
    return false;
  end if;
  parts := string_to_array(p_topic, ':');
  a := parts[2]::uuid;
  b := parts[3]::uuid;
  if not (a < b) or me not in (a, b) then
    return false;
  end if;
  return exists (
    select 1 from public.contacts c where c.user_a = a and c.user_b = b and c.status = 'accepted'
  );
end $$;

create function private.contact_count(p_user uuid) returns int
language sql stable security definer set search_path = '' as $$
  select count(*)::int from public.contacts c where p_user in (c.user_a, c.user_b)
$$;

-- ---------------------------------------------------------------------------
-- Policies on existing tables (added alongside the "own" policies; they OR)
-- ---------------------------------------------------------------------------
create policy "devices: read contacts' devices" on public.devices
  for select to authenticated using (private.is_contact(user_id));

drop policy "transfers: create own" on public.transfers;
create policy "transfers: create to own or contact device" on public.transfers
  for insert to authenticated with check (
    user_id = (select auth.uid())
    and private.owns_device(from_device_id)
    and private.can_send_to_device(to_device_id)
  );
create policy "transfers: read sent to me" on public.transfers
  for select to authenticated using (private.owns_device(to_device_id, true));
create policy "transfers: receiver updates" on public.transfers
  for update to authenticated
  using (private.owns_device(to_device_id, true)) with check (private.owns_device(to_device_id, true));

create policy "relay_objects: read sent to me" on public.relay_objects
  for select to authenticated using (private.is_recipient(transfer_id));
create policy "relay_objects: delete sent to me" on public.relay_objects
  for delete to authenticated using (private.is_recipient(transfer_id));

create policy "relay: read objects sent to me" on storage.objects
  for select to authenticated
  using (bucket_id = 'relay' and private.is_relay_object_for_me(name));
create policy "relay: delete objects sent to me" on storage.objects
  for delete to authenticated
  using (bucket_id = 'relay' and private.is_relay_object_for_me(name));

create policy "realtime: join contact pair channel" on realtime.messages
  for select to authenticated
  using (
    realtime.messages.extension in ('broadcast', 'presence')
    and private.can_join_pair((select realtime.topic()))
  );
create policy "realtime: send on contact pair channel" on realtime.messages
  for insert to authenticated
  with check (
    realtime.messages.extension in ('broadcast', 'presence')
    and private.can_join_pair((select realtime.topic()))
  );

-- ---------------------------------------------------------------------------
-- Transfers state machine: same rules for the sender as before; a receiver
-- who isn't the sender may only finish a relayed transfer (delivered or
-- failed) and can't touch the relay parameters.
-- ---------------------------------------------------------------------------
create or replace function private.transfers_before_update() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  -- current_user is the function owner inside SECURITY DEFINER, so look at
  -- the JWT role (Edge Functions with the service key) or the session user
  -- (pg_cron / psql run as postgres).
  is_service boolean := coalesce((select auth.role()) = 'service_role', false)
    or session_user in ('postgres', 'supabase_admin');
  is_sender boolean := old.user_id = (select auth.uid());
  recent int;
  missing int;
begin
  if not is_service and not is_sender then
    if new.relay_params is distinct from old.relay_params then
      raise exception 'only the sender can start the relay' using errcode = '42501';
    end if;
    if new.status is distinct from old.status
       and not (old.status = 'relayed' and new.status in ('delivered', 'failed')) then
      raise exception 'invalid status change % -> %', old.status, new.status using errcode = '42501';
    end if;
    new.delivered_at := case when new.status = 'delivered' and old.status <> 'delivered'
                             then now() else old.delivered_at end;
    return new;
  end if;

  -- Starting a relay: allowed once, while pending, within limits.
  if new.relay_params is distinct from old.relay_params then
    if old.relay_params is not null or old.status <> 'pending' then
      raise exception 'relay parameters are immutable' using errcode = '42501';
    end if;
    if new.relay_params is null then
      raise exception 'relay parameters cannot be removed' using errcode = '42501';
    end if;
    if old.total_bytes > private.limit_relay_bytes_per_transfer() then
      raise exception 'too_large: transfer exceeds the relay size limit' using errcode = 'PT413';
    end if;
    perform private.lock_user(old.user_id);
    select count(*) into recent from public.transfers
      where user_id = old.user_id and relay_started_at > now() - interval '1 hour';
    if recent >= private.limit_relay_transfers_per_hour() then
      raise exception 'rate_limited: too many relayed transfers this hour' using errcode = 'PT429';
    end if;
    new.relay_started_at := now();
  end if;

  if new.status is distinct from old.status then
    if not is_service and not (
      (old.status = 'pending' and new.status in ('p2p', 'relayed', 'delivered', 'failed', 'cancelled'))
      or (old.status = 'p2p' and new.status in ('pending', 'delivered', 'failed', 'cancelled'))
      or (old.status = 'relayed' and new.status in ('delivered', 'failed', 'cancelled'))
    ) then
      raise exception 'invalid status change % -> %', old.status, new.status using errcode = '42501';
    end if;

    if new.status = 'relayed' then
      if new.relay_params is null then
        raise exception 'relay was never started' using errcode = '42501';
      end if;
      select count(*) into missing from public.relay_objects r
        where r.transfer_id = new.id
          and not exists (
            select 1 from storage.objects o
            where o.bucket_id = 'relay' and o.name = r.storage_path
              and coalesce((o.metadata ->> 'size')::bigint, 0) <= r.byte_size
          );
      if missing > 0 then
        raise exception 'relay upload incomplete or mismatched' using errcode = '42501';
      end if;
      if not exists (select 1 from public.relay_objects r where r.transfer_id = new.id and r.file_index = -1) then
        raise exception 'relay manifest missing' using errcode = '42501';
      end if;
    end if;

    if new.status = 'delivered' then
      new.delivered_at := now();
    end if;
  end if;

  return new;
end $$;

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------

-- My contacts and requests. The other person's email is only included while a
-- request is pending, so whoever receives one can check who it's really from.
create function public.my_contacts()
returns table (
  user_id uuid,
  display_name text,
  email text,
  status text,
  incoming boolean,
  created_at timestamptz
)
language sql stable security definer set search_path = '' as $$
  select o.id,
         coalesce(p.display_name, ''),
         case when c.status = 'pending' then u.email::text end,
         c.status,
         c.requested_by <> (select auth.uid()),
         c.created_at
  from public.contacts c
  cross join lateral (
    select case when c.user_a = (select auth.uid()) then c.user_b else c.user_a end as id
  ) o
  join auth.users u on u.id = o.id
  left join public.profiles p on p.id = o.id
  where (select auth.uid()) in (c.user_a, c.user_b)
  order by c.status, coalesce(p.display_name, '')
$$;

-- Ask someone (by the email they signed up with) to be a contact. If they
-- already asked me, this accepts. Returns 'requested', 'accepted',
-- 'already_contacts', 'not_found' or 'self'.
create function public.request_contact(p_email text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  them uuid;
  existing public.contacts;
  recent int;
begin
  if me is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  perform private.lock_user(me);
  select count(*) into recent from public.contacts
    where requested_by = me and created_at > now() - interval '1 hour';
  if recent >= private.limit_contact_requests_per_hour() then
    raise exception 'rate_limited: too many contact requests this hour' using errcode = 'PT429';
  end if;

  select id into them from auth.users where lower(email) = lower(btrim(p_email)) limit 1;
  if them is null then
    return 'not_found';
  end if;
  if them = me then
    return 'self';
  end if;

  select * into existing from public.contacts
    where user_a = least(me, them) and user_b = greatest(me, them);
  if found then
    if existing.status = 'accepted' then
      return 'already_contacts';
    end if;
    if existing.requested_by = them then
      update public.contacts set status = 'accepted', accepted_at = now()
        where user_a = existing.user_a and user_b = existing.user_b;
      return 'accepted';
    end if;
    return 'requested';
  end if;

  if private.contact_count(me) >= private.limit_contacts()
     or private.contact_count(them) >= private.limit_contacts() then
    raise exception 'rate_limited: contact limit reached' using errcode = 'PT429';
  end if;
  insert into public.contacts (user_a, user_b, requested_by)
    values (least(me, them), greatest(me, them), me);
  return 'requested';
end $$;

-- Accept or decline a request someone sent me.
create function public.respond_contact(p_other uuid, p_accept boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
begin
  if p_accept then
    update public.contacts set status = 'accepted', accepted_at = now()
      where user_a = least(me, p_other) and user_b = greatest(me, p_other)
        and status = 'pending' and requested_by = p_other;
  else
    delete from public.contacts
      where user_a = least(me, p_other) and user_b = greatest(me, p_other)
        and status = 'pending' and requested_by = p_other;
  end if;
  if not found then
    raise exception 'no such request' using errcode = 'PT404';
  end if;
end $$;

-- Remove a contact, or cancel a request I sent. Either side can do this.
create function public.remove_contact(p_other uuid) returns void
language sql security definer set search_path = '' as $$
  delete from public.contacts
  where user_a = least((select auth.uid()), p_other)
    and user_b = greatest((select auth.uid()), p_other)
$$;

-- A one-time invite (QR code / link), valid for 30 minutes.
create function public.create_contact_invite()
returns table (token text, expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  recent int;
  t text;
  exp timestamptz := now() + interval '30 minutes';
begin
  if me is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  perform private.lock_user(me);
  delete from public.contact_invites i where i.user_id = me and i.expires_at < now() - interval '1 day';
  select count(*) into recent from public.contact_invites i
    where i.user_id = me and i.created_at > now() - interval '1 hour';
  if recent >= private.limit_invites_per_hour() then
    raise exception 'rate_limited: too many invites this hour' using errcode = 'PT429';
  end if;
  t := encode(extensions.gen_random_bytes(18), 'hex');
  insert into public.contact_invites (token_hash, user_id, expires_at)
    values (extensions.digest(t, 'sha256'), me, exp);
  return query select t, exp;
end $$;

-- Open someone's invite: we become contacts straight away.
create function public.accept_contact_invite(p_token text)
returns table (user_id uuid, display_name text)
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  inv public.contact_invites;
begin
  if me is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if p_token is null or p_token !~ '^[0-9a-f]{36}$' then
    raise exception 'invite_invalid' using errcode = 'PT404';
  end if;
  select * into inv from public.contact_invites
    where token_hash = extensions.digest(p_token, 'sha256')
    for update;
  if not found or inv.used_at is not null or inv.expires_at < now() then
    raise exception 'invite_invalid' using errcode = 'PT404';
  end if;
  if inv.user_id = me then
    raise exception 'invite_own' using errcode = 'PT409';
  end if;
  update public.contact_invites set used_at = now() where token_hash = inv.token_hash;

  if not exists (
    select 1 from public.contacts c
    where c.user_a = least(me, inv.user_id) and c.user_b = greatest(me, inv.user_id)
  ) and (private.contact_count(me) >= private.limit_contacts()
         or private.contact_count(inv.user_id) >= private.limit_contacts()) then
    raise exception 'rate_limited: contact limit reached' using errcode = 'PT429';
  end if;
  insert into public.contacts as c (user_a, user_b, requested_by, status, accepted_at)
    values (least(me, inv.user_id), greatest(me, inv.user_id), inv.user_id, 'accepted', now())
  on conflict (user_a, user_b) do update
    set status = 'accepted', accepted_at = coalesce(c.accepted_at, now());

  return query
    select inv.user_id, coalesce(p.display_name, '')
    from (select 1) x left join public.profiles p on p.id = inv.user_id;
end $$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
revoke all on function public.my_contacts(), public.request_contact(text),
  public.respond_contact(uuid, boolean), public.remove_contact(uuid),
  public.create_contact_invite(), public.accept_contact_invite(text) from public, anon;
grant execute on function public.my_contacts(), public.request_contact(text),
  public.respond_contact(uuid, boolean), public.remove_contact(uuid),
  public.create_contact_invite(), public.accept_contact_invite(text) to authenticated;

revoke all on function private.limit_contacts(), private.limit_contact_requests_per_hour(),
  private.limit_invites_per_hour(), private.contact_count(uuid) from public, anon, authenticated;
revoke all on function private.is_contact(uuid), private.can_send_to_device(uuid),
  private.is_recipient(uuid), private.is_relay_object_for_me(text),
  private.can_join_pair(text) from public, anon;
-- Used inside RLS policies evaluated as the caller.
grant execute on function private.is_contact(uuid), private.can_send_to_device(uuid),
  private.is_recipient(uuid), private.is_relay_object_for_me(text),
  private.can_join_pair(text) to authenticated;
