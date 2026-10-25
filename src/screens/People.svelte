<script lang="ts">
  import { untrack } from 'svelte';
  import {
    contacts,
    acceptInvite,
    createInvite,
    refreshContacts,
    removeContact,
    requestContact,
    respondContact,
  } from '../lib/state/contacts.svelte';
  import { inviteUrl, type Invite } from '../lib/services/contactsApi';
  import { session } from '../lib/state/session.svelte';
  import { isOnline } from '../lib/state/presence.svelte';
  import { router, navigate } from '../lib/state/router.svelte';
  import { humanError } from '../lib/core/errors';
  import type { DeviceKind } from '../lib/core/types';
  import TopBar from '../components/TopBar.svelte';
  import Icon from '../components/Icon.svelte';
  import QrCode from '../components/QrCode.svelte';

  const accepted = $derived(contacts.list.filter((c) => c.status === 'accepted'));
  const incoming = $derived(contacts.list.filter((c) => c.status === 'pending' && c.incoming));
  const outgoing = $derived(contacts.list.filter((c) => c.status === 'pending' && !c.incoming));
  const devicesOf = (userId: string) => session.contactDevices.filter((d) => d.user_id === userId);
  const nameOf = (c: { name: string; email: string | null }) => c.name || c.email || 'Someone';
  const iconFor = (k: DeviceKind) =>
    k === 'android' || k === 'ios'
      ? 'phone'
      : k === 'windows' || k === 'linux'
        ? 'desktop'
        : 'laptop';

  // Fresh list whenever the screen opens (someone may have accepted meanwhile).
  $effect(() => {
    void refreshContacts();
  });

  // ---- Opening someone's invite link (/add?invite=…) ----
  let joining = $state<'idle' | 'busy' | 'done' | 'error'>('idle');
  let joined = $state<{ userId: string; name: string } | null>(null);
  let joinError = $state('');
  $effect(() => {
    const code = router.query.get('invite');
    if (!code || joining !== 'idle') return;
    joining = 'busy';
    acceptInvite(code)
      .then((r) => {
        joined = r;
        joining = 'done';
      })
      .catch((e) => {
        joinError = humanError(e);
        joining = 'error';
      })
      // Don't leave a used code in the address bar or history.
      .finally(() => navigate('/people', { replace: true }));
  });

  // ---- My QR code / link ----
  let invite = $state<Invite | null>(null);
  let now = $state(Date.now());
  let inviteError = $state('');
  let copied = $state(false);
  let connectedName = $state('');
  const url = $derived(invite ? inviteUrl(invite.token) : '');
  const left = $derived(invite ? Math.max(0, invite.expiresAt - now) : 0);
  const canShare = typeof navigator.share === 'function';

  async function showCode() {
    inviteError = '';
    connectedName = '';
    copied = false;
    try {
      invite = await createInvite();
      now = Date.now();
    } catch (e) {
      inviteError = humanError(e);
    }
  }

  // While the code is on screen, watch for the other person opening it.
  $effect(() => {
    if (!invite) return;
    const before = untrack(() => new Set(accepted.map((c) => c.userId)));
    const tick = setInterval(() => (now = Date.now()), 1000);
    const poll = setInterval(async () => {
      await refreshContacts();
      const fresh = contacts.list.find((c) => c.status === 'accepted' && !before.has(c.userId));
      if (fresh) {
        connectedName = nameOf(fresh);
        invite = null;
      }
    }, 3000);
    return () => {
      clearInterval(tick);
      clearInterval(poll);
    };
  });

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url);
      copied = true;
    } catch {
      inviteError = "Couldn't copy. Press and hold the link to copy it.";
    }
  }

  function shareLink() {
    navigator.share({ title: 'DropLink', text: 'Add me on DropLink', url }).catch(() => {});
  }

  // ---- Add by email ----
  let email = $state('');
  let adding = $state(false);
  let addMessage = $state('');
  let addError = $state('');
  const RESULT: Record<string, string> = {
    requested: "Request sent. They'll see it the next time they open DropLink.",
    accepted: "They'd already asked you, so you're now connected.",
    already_contacts: "You're already connected.",
    not_found: 'No DropLink account uses that email. Show them your QR code instead.',
    self: "That's your own email.",
  };
  async function addByEmail(event: SubmitEvent) {
    event.preventDefault();
    addMessage = '';
    addError = '';
    adding = true;
    try {
      const r = await requestContact(email);
      addMessage = RESULT[r] ?? '';
      if (r === 'requested' || r === 'accepted') email = '';
    } catch (e) {
      addError = humanError(e);
    } finally {
      adding = false;
    }
  }

  // ---- Requests and contacts ----
  let actionError = $state('');
  let confirmRemove = $state<string | null>(null);
  async function act(fn: () => Promise<unknown>) {
    actionError = '';
    try {
      await fn();
    } catch (e) {
      actionError = humanError(e);
    }
  }

  const mmss = (ms: number) =>
    `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;
</script>

<main id="main" tabindex="-1" class="people container">
  <TopBar title="People" subtitle="Send to friends and family, Android or iPhone" />

  {#if joining === 'busy'}
    <p class="card" role="status">Connecting…</p>
  {:else if joining === 'done' && joined}
    <section class="card joined rise" role="status">
      <span class="ok-dot"><Icon name="check" size={18} stroke={2.4} /></span>
      <div class="grow">
        <p class="strong">You and {joined.name || 'your contact'} are connected</p>
        <p class="muted small">Their devices now show up when you send.</p>
      </div>
      <a class="button primary" href="/send?to={joined.userId}">Send</a>
    </section>
  {:else if joining === 'error'}
    <p class="card warn" role="alert">{joinError}</p>
  {/if}

  {#if connectedName}
    <p class="card joined strong rise" role="status">
      <span class="ok-dot"><Icon name="check" size={18} stroke={2.4} /></span>
      Connected with {connectedName}
    </p>
  {/if}

  <section class="card code rise" aria-labelledby="code-title">
    <h2 id="code-title" class="eyebrow">Add someone nearby</h2>
    {#if invite && left > 0}
      <div class="qr-wrap">
        <QrCode text={url} size={232} label="Your DropLink QR code" />
      </div>
      <p class="center">Scan this with the other phone's camera.</p>
      <p class="muted small center">
        Works once · expires in {mmss(left)} · or send them the link
      </p>
      <div class="row wrap center-row">
        <button class="pill" onclick={copyLink}
          ><Icon name="link" size={16} />{copied ? 'Copied' : 'Copy link'}</button
        >
        {#if canShare}
          <button class="pill" onclick={shareLink}><Icon name="share" size={16} />Share link</button
          >
        {/if}
        <button class="pill" onclick={() => (invite = null)}>Done</button>
      </div>
      <p class="link-text small muted"><span class="sr-only">Invite link: </span>{url}</p>
    {:else}
      <p class="muted small">
        Show a QR code for them to scan, or send them a link. You're connected as soon as they open
        it. They need a DropLink account.
      </p>
      <button class="primary" onclick={showCode}
        ><Icon name="qr" size={18} />{invite ? 'Show a new code' : 'Show my QR code'}</button
      >
    {/if}
    {#if inviteError}<p class="error" role="alert">{inviteError}</p>{/if}
  </section>

  <form class="card rise d1" onsubmit={addByEmail} aria-labelledby="email-title">
    <h2 id="email-title" class="eyebrow">Add by email</h2>
    <div class="row">
      <label class="sr-only" for="contact-email">Their email</label>
      <input
        id="contact-email"
        class="grow"
        type="email"
        autocomplete="off"
        placeholder="their@email.com"
        required
        bind:value={email}
      />
      <button type="submit" class="primary" disabled={adding || !email.trim()}>Add</button>
    </div>
    {#if addMessage}<p class="small status" role="status">{addMessage}</p>{/if}
    {#if addError}<p class="error" role="alert">{addError}</p>{/if}
  </form>

  {#if actionError}<p class="error" role="alert">{actionError}</p>{/if}

  {#if incoming.length}
    <section class="card group rise d1" aria-labelledby="req-title">
      <h2 id="req-title" class="eyebrow">Wants to connect</h2>
      <ul class="list">
        {#each incoming as c (c.userId)}
          <li class="row request">
            <span class="avatar" aria-hidden="true">{nameOf(c).slice(0, 1).toUpperCase()}</span>
            <span class="grow">
              <span class="block strong ellipsis">{nameOf(c)}</span>
              {#if c.email && c.email !== nameOf(c)}<small class="block muted ellipsis"
                  >{c.email}</small
                >{/if}
            </span>
            <button class="pill" onclick={() => act(() => respondContact(c.userId, false))}
              >Decline</button
            >
            <button class="pill primary" onclick={() => act(() => respondContact(c.userId, true))}
              >Accept</button
            >
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  <section class="card group rise d2" aria-labelledby="people-title">
    <h2 id="people-title" class="eyebrow">Your people</h2>
    {#if contacts.loaded && accepted.length === 0}
      <p class="muted small empty">
        No one yet. Add someone above and their phone or computer appears when you send.
      </p>
    {/if}
    <ul class="list">
      {#each accepted as c (c.userId)}
        {@const devices = devicesOf(c.userId)}
        {@const online = devices.filter((d) => isOnline(d.id))}
        <li class="person">
          <div class="row">
            <span class="avatar" class:live={online.length > 0} aria-hidden="true"
              >{nameOf(c).slice(0, 1).toUpperCase()}</span
            >
            <span class="grow">
              <span class="block strong ellipsis">{nameOf(c)}</span>
              <small class="block" class:ok={online.length > 0}>
                {online.length
                  ? `Online on ${online.map((d) => d.name).join(', ')}`
                  : devices.length
                    ? `${devices.length === 1 ? devices[0].name : `${devices.length} devices`} · offline`
                    : 'No devices yet'}
              </small>
            </span>
            {#if devices.length}
              <a class="button pill" href="/send?to={c.userId}">Send</a>
            {/if}
            <button
              class="icon bare"
              aria-label="Remove {nameOf(c)}"
              aria-expanded={confirmRemove === c.userId}
              onclick={() => (confirmRemove = confirmRemove === c.userId ? null : c.userId)}
              ><Icon name="x" size={16} /></button
            >
          </div>
          {#if devices.length}
            <ul class="devs" aria-label="{nameOf(c)}'s devices">
              {#each devices as d (d.id)}
                <li>
                  <Icon name={iconFor(d.kind)} size={16} />{d.name}{#if isOnline(d.id)}<span
                      class="live-dot live"
                      aria-label="online"
                    ></span>{/if}
                </li>
              {/each}
            </ul>
          {/if}
          {#if confirmRemove === c.userId}
            <div class="row wrap confirm">
              <span class="small grow"
                >Remove {nameOf(c)}? You won't be able to send to each other.</span
              >
              <button class="pill" onclick={() => (confirmRemove = null)}>Keep</button>
              <button class="pill danger" onclick={() => act(() => removeContact(c.userId))}
                >Remove</button
              >
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  </section>

  {#if outgoing.length}
    <section class="card group rise d3" aria-labelledby="sent-title">
      <h2 id="sent-title" class="eyebrow">Requests you sent</h2>
      <ul class="list">
        {#each outgoing as c (c.userId)}
          <li class="row">
            <span class="grow">
              <span class="block ellipsis">{c.email ?? nameOf(c)}</span>
              <small class="block muted">Waiting for them to accept</small>
            </span>
            <button class="pill" onclick={() => act(() => removeContact(c.userId))}>Cancel</button>
          </li>
        {/each}
      </ul>
    </section>
  {/if}
</main>

<style>
  .people {
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
  }
  .card h2 {
    margin: 0 0 0.6rem;
  }
  .group {
    padding: 0.4rem 1rem;
  }
  .group h2 {
    margin: 0.65rem 0 0.15rem;
  }
  .code {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
  .code > button {
    align-self: flex-start;
  }
  .qr-wrap {
    align-self: center;
    padding: 10px;
    border-radius: 24px;
    background: #fff;
    box-shadow: var(--shadow);
  }
  .center {
    text-align: center;
    margin: 0;
  }
  .center-row {
    justify-content: center;
  }
  .wrap {
    flex-wrap: wrap;
  }
  .small {
    font-size: 0.82rem;
  }
  .strong {
    font-weight: 600;
  }
  .status {
    margin: 0.6rem 0 0;
  }
  .empty {
    margin: 0.5rem 0 0.75rem;
  }
  .joined {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin: 0;
  }
  .ok-dot {
    flex: none;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    background: var(--ok);
    color: #fff;
  }
  .avatar {
    flex: none;
    width: 40px;
    height: 40px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    font-family: var(--display);
    font-weight: 700;
    background: var(--accent-soft);
    color: var(--accent-link);
  }
  .avatar.live {
    box-shadow:
      0 0 0 3px var(--surface),
      0 0 0 5px var(--ok);
  }
  .person {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .devs {
    list-style: none;
    margin: 0 0 0 3.25rem;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem 0.9rem;
    font-size: 0.82rem;
    color: var(--text-2);
  }
  .devs li {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
  }
  .ok {
    color: var(--ok-strong);
  }
  .confirm {
    gap: 0.5rem;
    padding: 0.6rem 0.75rem;
    border-radius: 14px;
    background: var(--danger-soft);
  }
  .bare {
    border: none !important;
    background: transparent !important;
  }
  button.danger {
    background: var(--danger);
    color: var(--danger-text);
    border-color: transparent;
  }
  button.primary.pill {
    background: var(--accent-button);
  }
  .link-text {
    margin: 0;
    text-align: center;
    word-break: break-all;
    user-select: all;
  }
  .request {
    flex-wrap: wrap;
  }
  .request .grow {
    min-width: 11rem;
  }
</style>
