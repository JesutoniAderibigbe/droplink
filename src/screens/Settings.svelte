<script lang="ts">
  import { session, renameDevice, removeDevice } from '../lib/state/session.svelte';
  import { auth, signOut } from '../lib/state/auth.svelte';
  import { humanError } from '../lib/core/errors';
  import { timeAgo } from '../lib/core/format';
  import DeviceIcon from '../components/DeviceIcon.svelte';

  let thisName = $state(session.device?.name ?? '');
  let editing = $state<string | null>(null);
  let editName = $state('');
  let confirmRemove = $state<string | null>(null);
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

  function saveThisName(event: SubmitEvent) {
    event.preventDefault();
    run(() => renameDevice(session.device!.id, thisName), 'Saved.');
  }

  function saveEdit(event: SubmitEvent, id: string) {
    event.preventDefault();
    run(async () => {
      await renameDevice(id, editName);
      editing = null;
    });
  }
</script>

<main class="container stack">
  <h1>Settings</h1>

  <section class="card stack" aria-labelledby="this-title">
    <h2 id="this-title">This device</h2>
    <form class="row" onsubmit={saveThisName}>
      <label class="sr-only" for="this-name">Device name</label>
      <input id="this-name" maxlength="60" bind:value={thisName} required />
      <button type="submit" disabled={!thisName.trim() || thisName === session.device?.name}
        >Save</button
      >
    </form>
  </section>

  <section class="card stack" aria-labelledby="manage-title">
    <h2 id="manage-title">Manage devices</h2>
    <p class="muted">
      Removing a device stops it from sending or receiving. It's signed out the next time it opens
      DropLink.
    </p>
    <ul class="list">
      {#each session.devices as d (d.id)}
        <li class="stack device">
          {#if editing === d.id}
            <form class="row" onsubmit={(e) => saveEdit(e, d.id)}>
              <label class="sr-only" for="edit-{d.id}">New name for {d.name}</label>
              <input id="edit-{d.id}" maxlength="60" bind:value={editName} required />
              <button type="submit" class="primary">Save</button>
              <button type="button" onclick={() => (editing = null)}>Cancel</button>
            </form>
          {:else}
            <div class="row">
              <DeviceIcon kind={d.kind} />
              <span class="grow">
                <strong class="ellipsis">{d.name}</strong>
                {#if d.id === session.device?.id}<span class="badge">This device</span>{/if}
                <br /><small class="muted"
                  >Added {timeAgo(d.created_at)} · last seen {timeAgo(d.last_seen_at)}</small
                >
              </span>
            </div>
            <div class="row wrap">
              <button
                onclick={() => ((editing = d.id), (editName = d.name), (confirmRemove = null))}
                >Rename</button
              >
              {#if confirmRemove === d.id}
                <button class="danger solid" onclick={() => run(() => removeDevice(d.id))}>
                  {d.id === session.device?.id ? 'Remove and sign out' : 'Yes, remove'}
                </button>
                <button onclick={() => (confirmRemove = null)}>Keep</button>
              {:else}
                <button class="danger" onclick={() => (confirmRemove = d.id)}>Remove…</button>
              {/if}
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  </section>

  {#if message}<p role="status">{message}</p>{/if}
  {#if error}<p class="error" role="alert">{error}</p>{/if}

  <section class="card stack" aria-labelledby="account-title">
    <h2 id="account-title">Account</h2>
    <p class="muted">Signed in as {auth.session?.user.email}</p>
    <div class="row wrap">
      <button onclick={signOut}>Sign out</button>
    </div>
    <p class="row wrap"><a href="/privacy">Privacy</a> · <a href="/terms">Terms</a></p>
  </section>
</main>

<style>
  .device {
    gap: 0.5rem;
  }
</style>
