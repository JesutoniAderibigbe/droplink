<script lang="ts">
  import type { SendFile } from '../lib/core/sink';
  import type { DeviceKind } from '../lib/core/types';
  import { formatBytes, plural } from '../lib/core/format';
  import {
    otherDevices,
    deviceById,
    deviceLabel,
    isOwnDevice,
    session,
  } from '../lib/state/session.svelte';
  import { contacts, refreshContacts } from '../lib/state/contacts.svelte';
  import { isOnline } from '../lib/state/presence.svelte';
  import {
    transfers,
    sendFiles,
    toSendFiles,
    cancelOutgoing,
    relayNow,
  } from '../lib/state/transfers.svelte';
  import { settings, preferredTarget, updateSettings } from '../lib/state/settings.svelte';
  import { router, navigate } from '../lib/state/router.svelte';
  import { listEntries, removeEntry } from '../lib/services/outbox';
  import { TEXT_ITEM_MIME } from '../lib/config';
  import TopBar from '../components/TopBar.svelte';
  import FileThumb from '../components/FileThumb.svelte';
  import Icon from '../components/Icon.svelte';
  import TransferStage from '../components/TransferStage.svelte';

  let files = $state<SendFile[]>([]);
  let dragging = $state(false);
  let input: HTMLInputElement | undefined = $state();

  $effect(() => {
    void refreshContacts();
  });
  const onlineFirst = (a: { id: string }, b: { id: string }) =>
    Number(isOnline(b.id)) - Number(isOnline(a.id));
  const mine = $derived(otherDevices().toSorted(onlineFirst));
  // Accepted contacts with at least one device, people with someone online first.
  const people = $derived(
    contacts.list
      .filter((c) => c.status === 'accepted')
      .map((c) => ({
        ...c,
        devices: session.contactDevices.filter((d) => d.user_id === c.userId).toSorted(onlineFirst),
      }))
      .filter((p) => p.devices.length > 0)
      .toSorted((a, b) => onlineFirst(a.devices[0], b.devices[0])),
  );
  const devices = $derived([...mine, ...people.flatMap((p) => p.devices)]);
  let target = $state<string | null>(null);
  // Preselect: "Send" from People (?to=their user id) picks their first online
  // device; otherwise the default device, else most recently used, else the
  // first online one.
  $effect(() => {
    if (target && devices.some((d) => d.id === target)) return;
    const to = router.query.get('to');
    const theirs = people.find((p) => p.userId === to)?.devices[0]?.id;
    const ids = devices.map((d) => d.id);
    target =
      theirs ?? preferredTarget(ids) ?? devices.find((d) => isOnline(d.id))?.id ?? ids[0] ?? null;
  });
  const targetDevice = $derived(target ? deviceById(target) : undefined);
  const targetName = $derived(targetDevice ? deviceLabel(targetDevice) : '');

  // The send in progress on this screen (identified by its createdAt).
  let currentKey = $state<number | null>(null);
  let sentFiles = $state<Map<string, SendFile>>(new Map());
  const current = $derived(
    currentKey === null
      ? null
      : (transfers.outgoing.find((t) => t.createdAt === currentKey) ?? null),
  );
  const finished = $derived(
    !!current && ['delivered', 'relayed', 'partial', 'failed', 'cancelled'].includes(current.phase),
  );

  const totalBytes = $derived(files.reduce((s, f) => s + f.size, 0));

  // Files shared from another app arrive through the service worker's outbox.
  let sharedEntryIds: string[] = [];
  let shareError = $state(router.query.get('shared') === 'error');
  let autoSent = $state(false);
  const textPreviews = $state<Record<string, string>>({});

  $effect(() => {
    if (router.query.get('shared') !== '1') return;
    void listEntries('shared').then(async (entries) => {
      sharedEntryIds = entries.map((e) => e.id);
      const incoming = entries.flatMap((e) => e.files);
      for (const f of incoming) {
        if (f.mimeType === TEXT_ITEM_MIME) textPreviews[f.id] = (await f.blob.text()).slice(0, 300);
      }
      files = [...files.filter((f) => !incoming.some((i) => i.id === f.id)), ...incoming];
    });
  });

  // One-tap flow: "Send to my default device without asking".
  $effect(() => {
    if (
      autoSent ||
      !settings.loaded ||
      !settings.autoSend ||
      files.length === 0 ||
      sharedEntryIds.length === 0
    )
      return;
    const preferred = preferredTarget(devices.map((d) => d.id));
    if (!preferred) return;
    autoSent = true;
    target = preferred;
    send();
  });

  function addFiles(list: FileList | null | undefined) {
    if (!list?.length) return;
    files = [...files, ...toSendFiles(list)];
  }

  function remove(id: string) {
    files = files.filter((f) => f.id !== id);
  }

  function send() {
    if (!target || files.length === 0) return;
    sentFiles = new Map(files.map((f) => [f.id, f]));
    currentKey = sendFiles(target, files);
    void updateSettings({ lastTargetId: target });
    files = [];
    // The engine holds the files now (and re-persists them if it has to wait).
    for (const id of sharedEntryIds) void removeEntry(id);
    sharedEntryIds = [];
    if (router.query.has('shared')) navigate('/send', { replace: true });
  }

  function sendMore() {
    currentKey = null;
    sentFiles = new Map();
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    dragging = false;
    if (!current) addFiles(e.dataTransfer?.files);
  }

  const iconFor = (k: DeviceKind) =>
    k === 'android' || k === 'ios'
      ? 'phone'
      : k === 'windows' || k === 'linux'
        ? 'desktop'
        : 'laptop';
  const subtitle = $derived(
    current
      ? `${plural(current.files.length, 'item')} · ${formatBytes(current.totalBytes)}`
      : files.length
        ? `${plural(files.length, 'item')}${router.query.get('shared') === '1' ? ' shared with DropLink' : ''} · ${formatBytes(totalBytes)}`
        : 'Pick what to send',
  );
</script>

<svelte:window
  ondragover={(e) => {
    e.preventDefault();
    dragging = true;
  }}
  ondragleave={(e) => {
    if (!e.relatedTarget) dragging = false;
  }}
  ondrop={onDrop}
/>

<main id="main" tabindex="-1" class="send container">
  <TopBar title="Send" {subtitle} />

  {#if shareError}
    <p class="card warn" role="alert">
      Those shared files couldn't be read. Try sharing them again, or pick them here.
    </p>
  {/if}

  {#if current}
    <!-- A send is under way: its files with progress, then the stage visual. -->
    <ul class="files" aria-label="Files being sent">
      {#each current.files as f (f.id)}
        <li class="card file rise">
          <FileThumb
            name={f.name}
            mime={sentFiles.get(f.id)?.mimeType}
            blob={sentFiles.get(f.id)?.blob}
          />
          <span class="grow">
            <span class="row spread">
              <span class="ellipsis fname">{f.name}</span>
              <small>{formatBytes(f.size)}</small>
            </span>
            {#if f.status === 'sending' || (f.status === 'queued' && current.phase === 'relaying')}
              <span
                class="bar"
                role="progressbar"
                aria-label="Progress for {f.name}"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round((f.transferred / Math.max(1, f.size)) * 100)}
              >
                <span
                  class="fill"
                  style:width="{Math.max(4, (f.transferred / Math.max(1, f.size)) * 100)}%"
                  ><span class="sheen"></span></span
                >
              </span>
              <small class="block">{formatBytes(f.transferred)} of {formatBytes(f.size)}</small>
            {:else if f.status === 'done'}
              <small class="block ok"
                >{current.phase === 'relayed' ? 'Uploaded' : 'Delivered'}</small
              >
            {:else if f.status === 'cancelled'}
              <small class="block">Cancelled</small>
            {:else if f.status === 'failed'}
              <small class="block error">{f.error ?? 'Failed'}</small>
            {:else}
              <small class="block">Waiting</small>
            {/if}
          </span>
        </li>
      {/each}
    </ul>

    <div class="stage-wrap"><TransferStage t={current} /></div>
  {:else}
    {#if files.length}
      <ul class="files" aria-label="Selected files">
        {#each files as f (f.id)}
          <li class="card file rise">
            <FileThumb name={f.name} mime={f.mimeType} blob={f.blob} />
            <span class="grow">
              {#if f.mimeType === TEXT_ITEM_MIME}
                <span class="ellipsis fname block">Text</span>
                <small class="block ellipsis">{textPreviews[f.id] ?? ''}</small>
              {:else}
                <span class="row spread">
                  <span class="ellipsis fname">{f.name}</span>
                  <small>{formatBytes(f.size)}</small>
                </span>
                <small class="block">{f.mimeType.split('/')[0] || 'File'}</small>
              {/if}
            </span>
            <button class="icon bare" aria-label="Remove {f.name}" onclick={() => remove(f.id)}
              ><Icon name="x" size={16} /></button
            >
          </li>
        {/each}
      </ul>
    {/if}

    <div class="drop card" class:dragging>
      <button class={files.length ? '' : 'primary'} onclick={() => input?.click()}>
        <Icon name="plus" size={18} stroke={2} />{files.length ? 'Add more files' : 'Choose files'}
      </button>
      <span class="muted hide-touch">or drop them anywhere on this page</span>
      <input
        bind:this={input}
        type="file"
        multiple
        class="sr-only"
        tabindex="-1"
        aria-hidden="true"
        onchange={(e) => {
          addFiles(e.currentTarget.files);
          e.currentTarget.value = '';
        }}
      />
    </div>

    <fieldset class="picker">
      <legend>Send to</legend>
      {#if devices.length === 0}
        <p class="muted">
          No one to send to yet. Sign in to DropLink on your other phone or computer with the same
          account, or <a href="/people">add someone</a>.
        </p>
      {/if}
      {#snippet option(d: (typeof devices)[number], label: string)}
        {@const online = isOnline(d.id)}
        <label class="option" class:checked={target === d.id}>
          <input type="radio" name="target" value={d.id} bind:group={target} class="sr-only" />
          <span class="tile"><Icon name={iconFor(d.kind)} size={22} /></span>
          <span class="grow">
            <span class="block dname ellipsis">{label}</span>
            <small class="block" class:ok={online}
              >{online ? 'Online' : 'Offline · will get a notification'}</small
            >
          </span>
          <span class="radio" aria-hidden="true"><span></span></span>
        </label>
      {/snippet}
      {#if mine.length && people.length}<p class="group-label">My devices</p>{/if}
      {#each mine as d (d.id)}
        {@render option(d, d.name)}
      {/each}
      {#each people as p (p.userId)}
        <p class="group-label">{p.name || 'Contact'}</p>
        {#each p.devices as d (d.id)}
          {@render option(d, d.name)}
        {/each}
      {/each}
      {#if devices.length}
        <a class="add-person" href="/people"><Icon name="plus" size={16} />Add someone</a>
      {/if}
      {#if target && targetDevice && isOwnDevice(targetDevice)}
        <label class="always">
          <input
            type="checkbox"
            checked={settings.autoSend && settings.defaultTargetId === target}
            onchange={(e) =>
              updateSettings(
                e.currentTarget.checked
                  ? { autoSend: true, defaultTargetId: target }
                  : { autoSend: false },
              )}
          />
          Always send shared files to {targetName} without asking
        </label>
      {/if}
    </fieldset>
  {/if}

  <div class="cta-bar">
    {#if !current}
      <button class="primary cta" disabled={!target || files.length === 0} onclick={send}>
        {target ? `Send to ${targetName}` : 'Send'}
      </button>
    {:else if current.phase === 'waiting'}
      <div class="two">
        <button class="cta neutral" onclick={() => cancelOutgoing(current.id)}>Cancel</button>
        {#if settings.relayEnabled && current.totalBytes <= 100 * 1024 * 1024}
          <button class="ink cta wide" onclick={() => relayNow(current.id)}>Relay now</button>
        {/if}
      </div>
    {:else if !finished}
      <button class="cta" onclick={() => cancelOutgoing(current.id)}>Cancel</button>
    {:else}
      <button class="ink cta" onclick={sendMore}>Send more</button>
    {/if}
  </div>
</main>

<style>
  .send {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .files {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
  .file {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.75rem;
    border-radius: 20px;
  }
  .fname {
    font-size: 0.9rem;
    font-weight: 500;
  }
  small {
    font-size: 0.75rem;
  }
  .ok {
    color: var(--ok-strong);
    font-weight: 500;
  }
  .bare {
    border: none !important;
    box-shadow: none !important;
    background: transparent;
    color: var(--text-2);
  }
  .bar {
    display: block;
    position: relative;
    margin: 0.5rem 0 0.25rem;
    height: 6px;
    border-radius: 999px;
    background: var(--track);
    overflow: hidden;
  }
  .fill {
    display: block;
    position: relative;
    height: 100%;
    border-radius: 999px;
    background: var(--accent);
    overflow: hidden;
    transition: width 0.3s linear;
  }
  .sheen {
    position: absolute;
    inset: 0 auto 0 0;
    width: 40%;
    background: linear-gradient(
      90deg,
      rgba(255, 255, 255, 0),
      rgba(255, 255, 255, 0.55),
      rgba(255, 255, 255, 0)
    );
    animation: sheen 1.2s linear infinite;
  }
  @keyframes sheen {
    from {
      transform: translateX(-100%);
    }
    to {
      transform: translateX(300%);
    }
  }
  .drop {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: 0.75rem;
    border-style: dashed;
    box-shadow: none;
    background: transparent;
  }
  .drop.dragging {
    border-color: var(--accent);
    background: var(--accent-tint);
  }
  .picker {
    border: none;
    margin: 0.25rem 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
  legend {
    font-size: 0.82rem;
    font-weight: 600;
    color: var(--text-2);
    padding: 0 0 0.5rem 0.25rem;
  }
  .option {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.75rem;
    margin: 0;
    border-radius: 22px;
    background: var(--surface);
    border: 1.5px solid var(--border);
    box-shadow: var(--shadow-sm);
    cursor: pointer;
    font-weight: 400;
    transition:
      border-color var(--dur),
      background var(--dur);
  }
  .option.checked {
    background: var(--accent-tint);
    border-color: var(--accent);
    box-shadow: 0 10px 24px rgba(232, 64, 15, 0.14);
  }
  .option:focus-within {
    outline: 3px solid var(--focus);
    outline-offset: 2px;
  }
  .tile {
    width: 46px;
    height: 46px;
    border-radius: 16px;
    background: var(--bg);
    display: flex;
    align-items: center;
    justify-content: center;
    flex: none;
  }
  .dname {
    font-weight: 600;
  }
  .radio {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    border: 2px solid var(--border-strong);
    display: flex;
    align-items: center;
    justify-content: center;
    flex: none;
  }
  .radio span {
    width: 10px;
    height: 10px;
    border-radius: 50%;
  }
  .checked .radio {
    border-color: var(--accent);
  }
  .checked .radio span {
    background: var(--accent);
  }
  .always {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    margin: 0.4rem 0 0 0.25rem;
    font-size: 0.85rem;
    font-weight: 400;
    color: var(--text-2);
    cursor: pointer;
  }
  .always input {
    width: 18px;
    height: 18px;
    flex: none;
  }
  .stage-wrap {
    margin-top: 0.5rem;
  }
  .cta-bar {
    position: sticky;
    bottom: calc(1rem + env(safe-area-inset-bottom));
    margin-top: 0.75rem;
  }
  .two {
    display: flex;
    gap: 0.6rem;
  }
  .two .cta {
    flex: 1;
  }
  .two .wide {
    flex: 1.4;
  }
  @media (pointer: coarse) {
    .hide-touch {
      display: none;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .sheen {
      animation: none;
      display: none;
    }
  }
  .group-label {
    margin: 0.75rem 0 0.35rem;
    font-size: 0.78rem;
    font-weight: 600;
    letter-spacing: 0.02em;
    color: var(--text-2);
  }
  .add-person {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    margin-top: 0.6rem;
    font-size: 0.85rem;
    font-weight: 600;
  }
</style>
