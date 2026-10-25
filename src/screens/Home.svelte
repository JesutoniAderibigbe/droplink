<script lang="ts">
  import { session, otherDevices } from '../lib/state/session.svelte';
  import { contacts } from '../lib/state/contacts.svelte';
  import { presence, isOnline } from '../lib/state/presence.svelte';
  import { transfers } from '../lib/state/transfers.svelte';
  import { listRecentTransfers } from '../lib/services/transfersApi';
  import { profile, loadProfile, saveName } from '../lib/state/profile.svelte';
  import { greeting as greet } from '../lib/core/greeting';
  import { humanError } from '../lib/core/errors';
  import { formatBytes, plural, timeAgo } from '../lib/core/format';
  import DeviceRadar from '../components/DeviceRadar.svelte';
  import FileThumb from '../components/FileThumb.svelte';
  import Icon from '../components/Icon.svelte';
  import FolderCard from '../components/FolderCard.svelte';
  import InstallCard from '../components/InstallCard.svelte';
  import PushCard from '../components/PushCard.svelte';
  import OutgoingCard from '../components/OutgoingCard.svelte';

  const others = $derived(otherDevices());
  const people = $derived(contacts.list.filter((c) => c.status === 'accepted'));
  const requests = $derived(contacts.list.filter((c) => c.status === 'pending' && c.incoming));
  const peopleOnline = $derived(
    people.filter((c) =>
      session.contactDevices.some((d) => d.user_id === c.userId && isOnline(d.id)),
    ).length,
  );
  const onlineCount = $derived(others.filter((d) => d.id in presence.online).length);
  const active = $derived(
    transfers.outgoing.filter((t) => !['delivered', 'relayed', 'cancelled'].includes(t.phase)),
  );

  // "Good evening, Toni". Accounts made before sign-up asked for a name get a prompt.
  $effect(() => {
    void loadProfile();
  });
  const greeting = $derived(greet(new Date().getHours(), profile.name));
  let nameInput = $state('');
  let nameError = $state('');
  function onSaveName(event: SubmitEvent) {
    event.preventDefault();
    nameError = '';
    saveName(nameInput).catch((e) => (nameError = humanError(e)));
  }

  // "Sent this week": delivered transfers from this device, from the database.
  let sentWeek = $state<number | null>(null);
  const phases = $derived(transfers.outgoing.map((t) => t.phase).join());
  $effect(() => {
    void phases;
    const since = Date.now() - 7 * 864e5;
    listRecentTransfers(200)
      .then((rows) => {
        sentWeek = rows
          .filter(
            (r) =>
              r.from_device_id === session.device?.id &&
              ['delivered', 'relayed'].includes(r.status),
          )
          .filter((r) => new Date(r.created_at).getTime() > since)
          .reduce((s, r) => s + r.total_bytes, 0);
      })
      .catch(() => (sentWeek = sentWeek ?? 0));
  });

  // Recent: this device's local history of sent + received files (names never leave the device).
  const recent = $derived(
    [
      ...transfers.sent.map((s) => ({
        key: `s${s.transferId}${s.fileId}`,
        name: s.name,
        mime: s.mimeType,
        line: `To ${s.toName} · ${formatBytes(s.size)} · ${s.via === 'relay' ? 'Encrypted relay' : 'P2P'}`,
        at: s.at,
        received: false,
      })),
      ...transfers.received.map((r) => ({
        key: `r${r.transferId}${r.fileId}`,
        name: r.location === 'text' ? (r.text ?? 'Shared text') : r.savedName,
        mime: r.location === 'text' ? 'application/x-droplink-text' : '',
        line: `From ${r.fromName} · ${r.location === 'text' ? 'Text' : formatBytes(r.size)} · ${timeAgo(r.at)}`,
        at: r.at,
        received: true,
      })),
    ]
      .sort((a, b) => b.at - a.at)
      .slice(0, 4),
  );
</script>

<main id="main" tabindex="-1" class="home container">
  <div class="glow-spot" style:top="60px" style:width="460px" style:height="460px"></div>

  <header class="row spread head">
    <div class="grow">
      <p class="muted hello">{greeting}</p>
      <h1 class="this-device ellipsis">{session.device!.name}</h1>
    </div>
    <a class="button icon" href="/settings" aria-label="Settings"><Icon name="settings" /></a>
  </header>

  {#if profile.loaded && !profile.name}
    <form class="card name-ask rise" onsubmit={onSaveName} aria-labelledby="name-ask-title">
      <label id="name-ask-title" for="name-ask">What should we call you?</label>
      <div class="row">
        <input
          id="name-ask"
          class="grow"
          autocomplete="name"
          maxlength="80"
          placeholder="Your name"
          bind:value={nameInput}
        />
        <button type="submit" class="primary" disabled={!nameInput.trim()}>Save</button>
      </div>
      {#if nameError}<p class="error" role="alert">{nameError}</p>{/if}
    </form>
  {/if}

  <DeviceRadar selfKind={session.device!.kind} devices={others} {isOnline} />

  {#if others.length === 0}
    <p class="card empty rise">
      Sign in to DropLink with the same account on your other phone or computer and it will appear
      on the radar.
    </p>
  {/if}
  {#if presence.status !== 'connected'}
    <p class="badge warn conn" role="status">
      {presence.status === 'connecting' ? 'Connecting…' : 'Offline, retrying…'}
    </p>
  {/if}

  <div class="stats rise">
    <div class="card stat">
      <span class="row muted small"><span class="dot live ok"></span>Online now</span>
      <p class="num">{plural(onlineCount, 'device')}</p>
    </div>
    <div class="card stat">
      <span class="muted small">Sent this week</span>
      <p class="num">{sentWeek === null ? '…' : formatBytes(sentWeek)}</p>
    </div>
  </div>

  <a class="card people-card rise" href="/people">
    <span class="faces" aria-hidden="true">
      {#each people.slice(0, 3) as c (c.userId)}
        <span class="face">{(c.name || '?').slice(0, 1).toUpperCase()}</span>
      {:else}
        <span class="face add"><Icon name="people" size={18} /></span>
      {/each}
    </span>
    <span class="grow">
      <span class="block strong">People</span>
      <small class="block muted">
        {people.length
          ? `${plural(people.length, 'person', 'people')}${peopleOnline ? ` · ${peopleOnline} online` : ''}`
          : 'Send to friends and family, Android or iPhone'}
      </small>
    </span>
    {#if requests.length}
      <span class="badge req">{plural(requests.length, 'request')}</span>
    {/if}
    <Icon name="right" size={18} />
  </a>

  {#each active as t (t.id)}
    <OutgoingCard {t} />
  {/each}

  <section class="card recent rise d1" aria-labelledby="recent-title">
    <div class="row spread">
      <h2 id="recent-title">Recent</h2>
      <a href="/receive" class="small">See all</a>
    </div>
    {#if recent.length === 0}
      <p class="muted small none">
        Nothing yet. Files you send or receive on this device show up here.
      </p>
    {:else}
      <ul class="list">
        {#each recent as r (r.key)}
          <li class="row item">
            <FileThumb name={r.name} mime={r.mime} size={38} />
            <span class="grow">
              {#if r.received}
                <a class="block ellipsis fname" href="/receive">{r.name}</a>
              {:else}
                <span class="block ellipsis fname">{r.name}</span>
              {/if}
              <small class="block ellipsis">{r.line}</small>
            </span>
            <span class="ok-check"
              ><Icon name="check" size={18} stroke={2.2} label="Delivered" /></span
            >
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <PushCard />
  <FolderCard />
  <InstallCard />

  <div class="cta-bar">
    <a class="button primary cta" href="/send"><Icon name="up" stroke={2.2} />Send files</a>
  </div>
</main>

<style>
  .home {
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
    overflow: hidden;
  }
  .home > :global(*:not(.glow-spot)) {
    position: relative;
    z-index: 1;
  }
  .head {
    margin-bottom: 0.25rem;
  }
  .hello {
    margin: 0;
    font-size: 0.82rem;
  }
  .this-device {
    font-size: 1.4rem;
    margin: 0.1rem 0 0;
  }
  .empty {
    text-align: center;
    font-size: 0.9rem;
    color: var(--text-2);
  }
  .conn {
    align-self: center;
    margin: 0;
  }
  .stats {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.65rem;
  }
  .stat {
    padding: 0.85rem;
    border-radius: 22px;
  }
  .small {
    font-size: 0.78rem;
  }
  .ok {
    color: var(--ok);
    background: var(--ok);
  }
  .num {
    margin: 0.35rem 0 0;
    font-family: var(--display);
    font-size: 1.45rem;
    font-weight: 700;
    letter-spacing: -0.02em;
  }
  .recent {
    padding: 0.4rem 0.9rem;
  }
  .recent h2 {
    font-family: var(--font);
    font-size: 0.85rem;
    font-weight: 600;
    letter-spacing: 0;
    margin: 0.5rem 0 0.25rem;
  }
  .none {
    margin: 0.25rem 0 0.75rem;
  }
  .item {
    gap: 0.75rem;
    padding: 0.6rem 0;
  }
  .fname {
    font-size: 0.9rem;
    font-weight: 500;
    color: inherit;
    text-decoration: none;
  }
  a.fname:hover {
    text-decoration: underline;
  }
  .ok-check {
    color: var(--ok);
    display: inline-flex;
  }
  .cta-bar {
    position: sticky;
    bottom: calc(1rem + env(safe-area-inset-bottom));
    margin-top: 0.5rem;
  }
  .name-ask {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
  .name-ask label {
    font-weight: 600;
  }
  .name-ask .row {
    gap: 0.5rem;
  }
  .name-ask .error {
    margin: 0;
  }
  .people-card {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    color: inherit;
    text-decoration: none;
  }
  .faces {
    display: flex;
  }
  .face {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    margin-left: -10px;
    border: 2px solid var(--surface);
    font-family: var(--display);
    font-weight: 700;
    background: var(--accent-soft);
    color: var(--accent-link);
  }
  .face:first-child {
    margin-left: 0;
  }
  .strong {
    font-weight: 600;
  }
  .badge.req {
    background: var(--accent-button);
    color: var(--accent-text);
  }
</style>
