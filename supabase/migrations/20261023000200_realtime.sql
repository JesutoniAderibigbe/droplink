-- Realtime Authorization for private channels.
--
-- Every signed-in client joins the private channel "user:{auth.uid()}" for
-- Presence (which devices are online) and Broadcast (WebRTC signaling and
-- transfer requests). These policies on realtime.messages are what Realtime
-- checks when a client joins a private channel (SELECT = may receive, INSERT =
-- may send), so a user can only ever join their own channel.

create policy "realtime: join own user channel" on realtime.messages
  for select to authenticated
  using (
    realtime.messages.extension in ('broadcast', 'presence')
    and (select realtime.topic()) = 'user:' || (select auth.uid())::text
  );

create policy "realtime: send on own user channel" on realtime.messages
  for insert to authenticated
  with check (
    realtime.messages.extension in ('broadcast', 'presence')
    and (select realtime.topic()) = 'user:' || (select auth.uid())::text
  );
