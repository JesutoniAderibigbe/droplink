<script lang="ts">
  import { session, renameDevice, removeDevice } from '../lib/state/session.svelte';
  import { auth, signOut } from '../lib/state/auth.svelte';
  import { humanError } from '../lib/core/errors';
  import { formatBytes, timeAgo } from '../lib/core/format';
  import type { DeviceKind } from '../lib/core/types';
  import { settings, updateSettings } from '../lib/state/settings.svelte';
  import { push, turnOnNotifications, turnOffNotifications } from '../lib/state/push.svelte';
  import { isOnline } from '../lib/state/presence.svelte';
  import { relayBytesUsedToday } from '../lib/services/relay';
  import { deleteAccount } from '../lib/services/account';
  import { LIMITS } from '../lib/config';
  import TopBar from '../components/TopBar.svelte';
  import Icon from '../components/Icon.svelte';
  import Orb from '../components/Orb.svelte';
  import { profile, loadProfile, saveName } from '../lib/state/profile.svelte';

  let message = $state('');
  let error = $state('');
  async function run(fn: () => Promise<void>, ok?: string) {
    error = '';
    message = '';
    try {
      await fn();
      if (ok) message = ok;
    } catch (e) {
      error = humanError(e);
    }
  }

  // Your name, for the greeting on Home.
  let myName = $state('');
  $effect(() => {
    void loadProfile().then(() => (myName = profile.name));
  });
  function onSaveMyName(event: SubmitEvent) {
    event.preventDefault();
    run(() => saveName(myName), 'Saved.');
  }

  // This device: inline rename in the dark card.
  let renamingSelf = $state(false);
  let thisName = $state(session.device?.name ?? '');
  function saveThisName(event: SubmitEvent) {
    event.preventDefault();
    run(async () => {
      await renameDevice(session.device!.id, thisName);
      renamingSelf = false;
    }, 'Saved.');
  }

  // Other devices: a "more" menu per row.
  let openMenu = $state<string | null>(null);
  let editing = $state<string | null>(null);
  let editName = $state('');
  let confirmRemove = $state<string | null>(null);
  function saveEdit(event: SubmitEvent, id: string) {
    event.preventDefault();
    run(async () => {
      await renameDevice(id, editName);
      editing = null;
    });
  }
  const others = $derived(session.devices.filter((d) => d.id !== session.device?.id));
  const iconFor = (k: DeviceKind) =>
    k === 'android' || k === 'ios'
      ? 'phone'
      : k === 'windows' || k === 'linux'
        ? 'desktop'
        : 'laptop';

  // Switches.
  function setOneTap(on: boolean) {
    const fallback = settings.defaultTargetId ?? settings.lastTargetId ?? others[0]?.id ?? null;
    void updateSettings(on ? { autoSend: true, defaultTargetId: fallback } : { autoSend: false });
  }
  function setNotifications(on: boolean) {
    run(() => (on ? turnOnNotifications() : turnOffNotifications()));
  }

  // Relay used today.
  let used = $state<number | null>(null);
  $effect(() => {
    void relayBytesUsedToday()
      .then((b) => (used = b))
      .catch(() => (used = 0));
  });

  // Delete account.
  let deleteOpen = $state(false);
  let deleteText = $state('');
  let deleting = $state(false);
  async function onDelete(event: SubmitEvent) {
    event.preventDefault();
    if (deleteText !== 'DELETE' || !session.userId) return;
    deleting = true;
    error = '';
    try {
      await deleteAccount(session.userId, session.device?.id ?? null);
    } catch (e) {
      error = humanError(e);
      deleting = false;
    }
  }
</script>

<main id="main" tabindex="-1" class="settings container">
  <TopBar title="Settings" />

  <section class="me rise" aria-labelledby="this-title">
    <Orb size={52} />
    {#if renamingSelf}
      <form class="grow row" onsubmit={saveThisName}>
        <label class="sr-only" for="this-name">Device name</label>
        <input id="this-name" maxlength="60" bind:value={thisName} required />
        <button type="submit" class="pill on-ink" disabled={!thisName.trim()}>Save</button>
      </form>
    {:else}
      <div class="grow">
        <p id="this-title" class="label">This device</p>
        <p class="name ellipsis">{session.device?.name}</p>
      </div>
      <button
        class="pill on-ink"
        onclick={() => ((renamingSelf = true), (thisName = session.device?.name ?? ''))}
      >
        Rename
      </button>
    {/if}
  </section>

  {#if message}<p class="status" role="status">{message}</p>{/if}
  {#if error}<p class="error" role="alert">{error}</p>{/if}

  <form class="card your-name rise d1" onsubmit={onSaveMyName}>
    <label class="eyebrow" for="my-name">Your name</label>
    <div class="row">
      <input
        id="my-name"
        class="grow"
        autocomplete="name"
        maxlength="80"
        placeholder="Your name"
        bind:value={myName}
      />
      <button
        type="submit"
        class="primary"
        aria-label="Save name"
        disabled={!myName.trim() || myName.trim() === profile.name}>Save</button
      >
    </div>
  </form>

  <section class="card group rise d1" aria-labelledby="devices-title">
    <h2 id="devices-title" class="eyebrow">My devices</h2>
    {#if others.length === 0}
      <p class="muted small empty">No other devices yet.</p>
    {/if}
    <ul class="list">
      {#each others as d (d.id)}
        {@const online = isOnline(d.id)}
        {@const isDefault = settings.defaultTargetId === d.id}
        <li class="device">
          {#if editing === d.id}
            <form class="row" onsubmit={(e) => saveEdit(e, d.id)}>
              <label class="sr-only" for="edit-{d.id}">New name for {d.name}</label>
              <input id="edit-{d.id}" maxlength="60" bind:value={editName} required />
              <button type="submit" class="primary">Save</button>
              <button type="button" onclick={() => (editing = null)}>Cancel</button>
            </form>
          {:else}
            <div class="row">
              <Icon name={iconFor(d.kind)} size={22} />
              <span class="grow">
                <span class="block ellipsis dname">{d.name}</span>
                <small class="block" class:ok={online}>
                  {online ? 'Online' : `Last seen ${timeAgo(d.last_seen_at)}`}{isDefault
                    ? ' · default target'
                    : ''}
                </small>
              </span>
              <button
                class="icon bare"
                aria-label="More options for {d.name}"
                aria-expanded={openMenu === d.id}
                onclick={() => (
                  (openMenu = openMenu === d.id ? null : d.id),
                  (confirmRemove = null)
                )}
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  aria-hidden="true"
                  ><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle
                    cx="19"
                    cy="12"
                    r="1.8"
                  /></svg
                >
              </button>
            </div>
            {#if openMenu === d.id}
              <div class="row wrap actions">
                <button
                  class="pill"
                  onclick={() => ((editing = d.id), (editName = d.name), (openMenu = null))}
                  >Rename</button
                >
                {#if !isDefault}
                  <button
                    class="pill"
                    onclick={() => ((openMenu = null), updateSettings({ defaultTargetId: d.id }))}
                  >
                    Make default
                  </button>
                {/if}
                {#if confirmRemove === d.id}
                  <button class="pill danger solid" onclick={() => run(() => removeDevice(d.id))}
                    >Yes, remove</button
                  >
                  <button class="pill" onclick={() => (confirmRemove = null)}>Keep</button>
                {:else}
                  <button class="pill danger" onclick={() => (confirmRemove = d.id)}>Remove…</button
                  >
                {/if}
              </div>
            {/if}
          {/if}
        </li>
      {/each}
    </ul>
  </section>

  <section class="card group rise d2" aria-label="Preferences">
    <label class="switch-row">
      <span class="grow">
        <span class="block">One-tap send</span>
        <small class="block muted">Sharing to DropLink sends straight to your default device</small>
      </span>
      <input
        type="checkbox"
        checked={settings.autoSend}
        onchange={(e) => setOneTap(e.currentTarget.checked)}
      />
    </label>
    <label class="switch-row">
      <span class="grow">
        <span class="block">Notifications</span>
        <small class="block muted">
          {push.permission === 'unsupported'
            ? 'Not supported in this browser'
            : push.permission === 'denied'
              ? 'Blocked in your browser settings'
              : 'Wake this device when files are on the way'}
        </small>
      </span>
      <input
        type="checkbox"
        checked={push.permission === 'granted' && push.subscribed}
        disabled={push.permission === 'unsupported' || push.permission === 'denied'}
        onchange={(e) => setNotifications(e.currentTarget.checked)}
      />
    </label>
    <label class="switch-row">
      <span class="grow">
        <span class="block">Encrypted relay fallback</span>
        <small class="block muted">Up to 100 MB · auto-deleted in 24 h</small>
      </span>
      <input
        type="checkbox"
        checked={settings.relayEnabled}
        onchange={(e) => updateSettings({ relayEnabled: e.currentTarget.checked })}
      />
    </label>
  </section>

  <section class="card usage rise d3" aria-label="Relay used today">
    <div class="row spread small">
      <span class="muted">Relay used today</span>
      <strong
        >{used === null ? '…' : formatBytes(used)} of {formatBytes(LIMITS.relayBytesPerDay)}</strong
      >
    </div>
    <div
      class="bar"
      role="progressbar"
      aria-label="Relay used today"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(((used ?? 0) / LIMITS.relayBytesPerDay) * 100)}
    >
      <span style:width="{Math.min(100, ((used ?? 0) / LIMITS.relayBytesPerDay) * 100)}%"></span>
    </div>
  </section>

  <div class="account">
    <p class="muted small center">Signed in as {auth.session?.user.email}</p>
    <button class="big" onclick={signOut}>Sign out</button>
    {#if !deleteOpen}
      <button class="link danger-link" onclick={() => (deleteOpen = true)}>Delete account</button>
    {:else}
      <form class="card stack danger-zone" onsubmit={onDelete}>
        <h2>Delete account</h2>
        <p class="small">
          This permanently deletes your account, all your devices, transfer history, push addresses
          and any files waiting in the encrypted relay. It can't be undone.
        </p>
        <div class="field">
          <label for="delete-confirm">Type DELETE to confirm</label>
          <input
            id="delete-confirm"
            autocomplete="off"
            autocapitalize="characters"
            bind:value={deleteText}
          />
        </div>
        <div class="row wrap">
          <button type="submit" class="danger solid" disabled={deleteText !== 'DELETE' || deleting}>
            {deleting ? 'Deleting…' : 'Delete my account'}
          </button>
          <button type="button" onclick={() => ((deleteOpen = false), (deleteText = ''))}
            >Keep my account</button
          >
        </div>
      </form>
    {/if}
    <p class="row wrap center small"><a href="/privacy">Privacy</a> · <a href="/terms">Terms</a></p>
  </div>
</main>

<style>
  .settings {
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
  }
  .me {
    display: flex;
    align-items: center;
    gap: 0.85rem;
    padding: 1rem;
    border-radius: 24px;
    background: var(--ink);
    color: var(--ink-text);
    box-shadow: 0 16px 36px rgba(17, 19, 24, 0.18);
  }
  .me input {
    min-height: 44px;
    background: rgba(255, 255, 255, 0.1);
    color: inherit;
    border-color: rgba(255, 255, 255, 0.25);
  }
  .label {
    margin: 0;
    font-size: 0.75rem;
    opacity: 0.75;
  }
  .name {
    margin: 0.1rem 0 0;
    font-family: var(--display);
    font-size: 1.25rem;
    font-weight: 700;
    letter-spacing: -0.3px;
  }
  .on-ink {
    background: transparent;
    color: inherit;
    border-color: color-mix(in srgb, currentColor 30%, transparent);
  }
  .group {
    padding: 0.4rem 1rem;
  }
  .group h2 {
    margin: 0.65rem 0 0.15rem;
  }
  .small {
    font-size: 0.8rem;
  }
  .empty {
    margin: 0.5rem 0 0.75rem;
  }
  .device {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .dname {
    font-weight: 500;
  }
  .ok {
    color: var(--ok-strong);
  }
  .bare {
    border: none !important;
    box-shadow: none !important;
    background: transparent;
    color: var(--text-2);
  }
  .actions {
    padding-left: 2rem;
  }
  .usage {
    padding: 0.9rem 1rem;
  }
  .bar {
    margin-top: 0.6rem;
    height: 6px;
    border-radius: 999px;
    background: var(--track);
    overflow: hidden;
  }
  .bar span {
    display: block;
    height: 100%;
    border-radius: 999px;
    background: var(--accent);
  }
  .account {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    align-items: stretch;
    margin-top: 0.5rem;
  }
  .center {
    justify-content: center;
    text-align: center;
    margin: 0;
  }
  .danger-link {
    align-self: center;
    color: var(--danger);
    min-height: 44px;
    text-decoration: none;
    font-weight: 600;
  }
  .danger-zone {
    border-color: var(--danger);
  }
  .danger-zone h2 {
    margin: 0;
  }
  .status {
    margin: 0;
    color: var(--ok-strong);
    font-weight: 500;
  }
  .your-name {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
  .your-name .row {
    gap: 0.5rem;
  }
</style>
