<script lang="ts">
  import { transfers, clearHistory, cancelIncomingFile } from '../lib/state/transfers.svelte';
  import { formatBytes, plural, timeAgo } from '../lib/core/format';
  import { router } from '../lib/state/router.svelte';
  import { getEngine } from '../lib/state/transfers.svelte';
  import { checkInbox } from '../lib/state/relay.svelte';
  import { presence } from '../lib/state/presence.svelte';
  import { session, otherDevices } from '../lib/state/session.svelte';
  import { folder, pickFolder, reallowFolder } from '../lib/state/folder.svelte';
  import { humanError } from '../lib/core/errors';
  import { TEXT_ITEM_MIME } from '../lib/config';
  import Beacon from '../components/Beacon.svelte';
  import FileThumb from '../components/FileThumb.svelte';
  import Icon from '../components/Icon.svelte';
  import Orb from '../components/Orb.svelte';
  import FileViewer from '../components/FileViewer.svelte';
  import { whereToFind } from '../lib/core/whereToFind';
  import type { ReceivedItem } from '../lib/state/transfers.svelte';
  import {
    canOpen,
    canShareFiles,
    getReceivedFile,
    openInNewTab,
    shareFile,
    viewKind,
  } from '../lib/services/receivedFiles';

  // Open / Share a received file saved into the chosen folder. Downloads can't
  // be reached from a web app, so those get directions instead.
  const directions = whereToFind({
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints,
  });
  let whereOpen = $state<string | null>(null);
  const shareable = canShareFiles();
  let viewing = $state<File | null>(null);
  let busyId = $state<string | null>(null);
  let openError = $state('');

  async function fetchFile(r: ReceivedItem): Promise<File | null> {
    openError = '';
    busyId = r.fileId;
    try {
      const f = await getReceivedFile(r);
      if (!f) {
        openError = `Couldn't find “${r.savedName}” in your DropLink folder any more. It may have been moved or deleted.`;
      }
      return f;
    } finally {
      busyId = null;
    }
  }

  async function open(r: ReceivedItem) {
    const f = await fetchFile(r);
    if (!f) return;
    if (viewKind(f) === 'other') openInNewTab(f);
    else viewing = f;
  }

  async function share(r: ReceivedItem) {
    const f = await fetchFile(r);
    if (!f) return;
    try {
      if ((await shareFile(f)) === 'unsupported')
        openError = 'This browser can’t share files. Use Open instead.';
    } catch (e) {
      openError = humanError(e);
    }
  }

  // Opened from a push notification (/receive?transfer=<id>): tell the waiting
  // sender we're here, as soon as we're connected to signaling.
  // Deliberately not reactive: only dedupes announcements.
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  const announced = new Set<string>();
  $effect(() => {
    const id = router.query.get('transfer');
    if (!id || presence.status !== 'connected' || announced.has(id)) return;
    announced.add(id);
    void checkInbox(); // it may already be waiting in the relay
    getEngine()
      .announceReady(id)
      .catch((e) => console.warn('[receive] announce failed', (e as Error)?.message));
  });

  const nearby = $derived(otherDevices().filter((d) => d.id in presence.online));
  const active = $derived(
    transfers.incoming.filter((t) => ['connecting', 'receiving', 'reconnecting'].includes(t.phase)),
  );
  const newest = $derived(active[0]);

  // Live receive speed for the highlighted file.
  let last: { bytes: number; at: number } | null = null;
  let speed = $state(0);
  $effect(() => {
    const bytes = active.reduce((s, t) => s + t.files.reduce((n, f) => n + f.received, 0), 0);
    const at = Date.now();
    if (last && at > last.at && bytes >= last.bytes) {
      const inst = ((bytes - last.bytes) / (at - last.at)) * 1000;
      speed = speed ? speed * 0.7 + inst * 0.3 : inst;
    }
    last = { bytes, at };
  });

  let copied = $state<string | null>(null);
  async function copy(id: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      copied = id;
      setTimeout(() => (copied = null), 2000);
    } catch {
      /* clipboard blocked: the text is selectable */
    }
  }

  let folderError = $state('');
  async function folderAction(fn: () => Promise<void>) {
    folderError = '';
    try {
      await fn();
    } catch (e) {
      folderError = humanError(e);
    }
  }
  const savingTo = $derived(
    folder.permission === 'granted' && folder.name ? folder.name : 'Browser downloads',
  );
  const isUrl = (s: string) => /^https?:\/\/\S+$/.test(s.trim());
</script>

<main id="main" tabindex="-1" class="receive container wide">
  <div class="glow-layer" aria-hidden="true">
    <div class="glow-spot left" style:top="120px" style:width="700px" style:height="700px"></div>
  </div>

  <header class="top row wrap spread">
    <div class="row wrap">
      <a href="/" class="button icon" aria-label="Back"><Icon name="back" stroke={2} /></a>
      <h1>Received</h1>
      <span class="badge ok">{session.device?.name} · receiving</span>
    </div>
    <nav class="row wrap" aria-label="Receive screen">
      <a class="button pill" href="/send">Send files</a>
      <a class="button pill bare" href="/settings">Settings</a>
    </nav>
  </header>

  <div class="cols">
    <section class="side">
      <div class="card ready rise">
        <Beacon size={110} orbit={false} />
        <h2>{active.length ? 'Catching…' : 'Ready to catch'}</h2>
        <p class="muted">
          {#if nearby.length}
            {nearby.map((d) => d.name).join(', ')}
            {nearby.length === 1 ? 'is' : 'are'} nearby. Keep this open, or just click the notification
            when something arrives.
          {:else}
            Keep DropLink open here, or turn on notifications in Settings so this device wakes up
            when files arrive.
          {/if}
        </p>
      </div>

      {#if folder.supported}
        <div class="card folder rise d1">
          <span class="folder-icon"><Icon name="folder" size={22} /></span>
          <span class="grow">
            <small class="block muted">Saving to</small>
            <span class="block fname">{savingTo}</span>
            {#if folder.permission === 'prompt'}
              <small class="block warn-text">Needs permission again after a browser restart</small>
            {/if}
          </span>
          {#if folder.permission === 'prompt'}
            <button class="pill primary" onclick={() => folderAction(reallowFolder)}
              >Allow access</button
            >
          {:else}
            <button class="pill" onclick={() => folderAction(pickFolder)}>
              {folder.permission === 'granted' ? 'Change' : 'Choose folder'}
            </button>
          {/if}
        </div>
        {#if folderError}<p class="error" role="alert">{folderError}</p>{/if}
      {:else}
        <p class="card soft small">
          Files go to your browser’s Downloads folder. For big files, and to save straight into a
          folder you choose, use Chrome or Edge on a computer.
        </p>
      {/if}
    </section>

    <section class="card list-card rise d2" aria-labelledby="received-title">
      <div class="row spread">
        <h2 id="received-title">On this device</h2>
        {#if transfers.received.length}<button class="link" onclick={clearHistory}
            >Clear history</button
          >{/if}
      </div>

      {#each active as t (t.id)}
        {#each t.files.filter((f) => f.status === 'receiving') as f (f.id)}
          <div class="live-file">
            <FileThumb name={f.name} size={48} />
            <span class="grow">
              <span class="row wrap spread">
                <span class="fname ellipsis">{f.name}</span>
                <small class="muted">
                  {formatBytes(f.received)} of {formatBytes(f.size)}{speed > 0
                    ? ` · ${formatBytes(speed)}/s`
                    : ''}
                </small>
              </span>
              <span
                class="bar"
                role="progressbar"
                aria-label="Receiving {f.name}"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round((f.received / Math.max(1, f.size)) * 100)}
              >
                <span
                  class="fill"
                  style:width="{Math.max(4, (f.received / Math.max(1, f.size)) * 100)}%"
                  ><span class="sheen"></span></span
                >
              </span>
            </span>
            {#if t.via === 'p2p'}
              <button
                class="icon bare"
                aria-label="Cancel {f.name}"
                onclick={() => cancelIncomingFile(t.id, f.id)}
              >
                <Icon name="x" size={16} />
              </button>
            {/if}
          </div>
        {/each}
        {#if t.phase === 'connecting' || t.phase === 'reconnecting'}
          <p class="muted small">
            {t.phase === 'connecting' ? 'Connecting to' : 'Reconnecting to'}
            {t.fromName}…
          </p>
        {:else if t.route}
          <p class="muted small">
            {t.route === 'lan'
              ? 'Direct over your local network'
              : t.route === 'internet'
                ? 'Direct over the internet: speed is limited by your internet upload'
                : 'Through the TURN relay server: speed is limited by your internet connection'}
          </p>
        {/if}
      {/each}

      {#if openError}<p class="error" role="alert">{openError}</p>{/if}

      {#if transfers.received.length === 0 && active.length === 0}
        <p class="muted empty">
          Nothing received yet. Files you send to this device from your other devices land here.
        </p>
      {:else}
        <ul class="list history">
          {#each transfers.received as r (r.transferId + r.fileId)}
            <li class="row wrap">
              {#if r.location === 'text'}
                <FileThumb name="text" mime={TEXT_ITEM_MIME} size={44} />
              {:else}
                <FileThumb name={r.savedName} size={44} />
              {/if}
              <span class="grow">
                <span class="block ellipsis fname"
                  >{r.location === 'text' ? (r.text ?? 'Shared text') : r.savedName}</span
                >
                <small class="block muted">
                  {r.location === 'text'
                    ? isUrl(r.text ?? '')
                      ? 'Link'
                      : 'Text'
                    : formatBytes(r.size)} from {r.fromName} ·
                  {timeAgo(r.at)}{#if r.checksumOk === true}
                    · ✓ checksum{/if}{#if r.checksumOk === false}
                    · ⚠ checksum mismatch{/if}
                </small>
              </span>
              {#if r.location === 'text' && r.text}
                <span class="row">
                  {#if isUrl(r.text)}
                    <a
                      class="button pill"
                      href={r.text.trim()}
                      target="_blank"
                      rel="noopener noreferrer">Open</a
                    >
                  {/if}
                  <button class="pill" onclick={() => copy(r.fileId, r.text!)}
                    >{copied === r.fileId ? 'Copied' : 'Copy'}</button
                  >
                </span>
              {:else}
                <span class="row actions">
                  {#if canOpen(r)}
                    <button class="pill" onclick={() => open(r)} disabled={busyId === r.fileId}
                      >Open</button
                    >
                    {#if shareable}
                      <button class="pill" onclick={() => share(r)} disabled={busyId === r.fileId}
                        >Share</button
                      >
                    {/if}
                  {:else}
                    <button
                      class="pill"
                      aria-expanded={whereOpen === r.transferId + r.fileId}
                      onclick={() =>
                        (whereOpen =
                          whereOpen === r.transferId + r.fileId ? null : r.transferId + r.fileId)}
                    >
                      Where is it?
                    </button>
                  {/if}
                </span>
              {/if}
              {#if whereOpen === r.transferId + r.fileId}
                <div class="where-panel" role="region" aria-label="Where to find {r.savedName}">
                  <p>
                    Saved to your <strong>{directions.place}</strong> folder as
                    <strong>{r.savedName}</strong>.
                  </p>
                  <ol>
                    {#each directions.steps as step (step)}<li>{step}</li>{/each}
                  </ol>
                </div>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  </div>

  {#if viewing}
    <FileViewer
      file={viewing}
      onclose={() => (viewing = null)}
      onshare={shareable ? () => viewing && shareFile(viewing).catch(() => {}) : undefined}
    />
  {/if}

  {#if newest}
    <aside class="glass incoming" aria-live="polite" aria-label="Incoming transfer">
      <div class="row">
        <Orb size={46}><Icon name="phone" size={20} /></Orb>
        <span class="grow">
          <span class="block fname">{newest.fromName}</span>
          <small class="block muted"
            >is sending {plural(newest.fileCount, 'file')} · {formatBytes(newest.totalBytes)}</small
          >
        </span>
      </div>
    </aside>
  {/if}
</main>

<style>
  .receive > :global(*:not(.glow-layer)) {
    position: relative;
    z-index: 1;
  }
  /* Fixed to the viewport so the glow bleeds softly without widening the page. */
  .glow-layer {
    position: fixed;
    inset: 0;
    overflow: hidden;
    pointer-events: none;
    z-index: 0;
  }
  .glow-spot.left {
    left: -120px;
    transform: none;
  }
  .top {
    margin-bottom: 1.25rem;
    gap: 0.75rem;
  }
  .top h1 {
    margin: 0;
    font-size: 1.4rem;
  }
  .cols {
    display: flex;
    flex-wrap: wrap;
    gap: 1.25rem;
    align-items: flex-start;
  }
  .side {
    flex: 1 1 340px;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  .list-card {
    flex: 999 1 480px;
    min-width: 0;
    border-radius: 32px;
    padding: 1.4rem;
    box-shadow: var(--shadow-lg);
  }
  .list-card h2 {
    margin: 0;
  }
  .ready {
    border-radius: 32px;
    padding: 1.25rem 1.5rem 1.5rem;
    text-align: center;
    box-shadow: var(--shadow-lg);
  }
  .ready h2 {
    font-size: 1.8rem;
    margin: 0;
  }
  .ready p {
    margin: 0.5rem 0 0;
    font-size: 0.9rem;
  }
  .folder {
    display: flex;
    align-items: center;
    gap: 0.85rem;
    border-radius: 24px;
    box-shadow: var(--shadow-sm);
  }
  .folder-icon {
    width: 44px;
    height: 44px;
    border-radius: 14px;
    background: var(--accent-soft);
    color: var(--accent-link);
    display: flex;
    align-items: center;
    justify-content: center;
    flex: none;
  }
  .warn-text {
    color: var(--warn);
  }
  .fname {
    font-weight: 600;
    font-size: 0.92rem;
  }
  .small {
    font-size: 0.82rem;
  }
  .live-file {
    margin-top: 1rem;
    padding: 1rem;
    border-radius: 22px;
    background: var(--accent-tint);
    border: 1px solid var(--accent-tint-border);
    display: flex;
    align-items: center;
    gap: 0.85rem;
  }
  .bar {
    display: block;
    margin-top: 0.6rem;
    height: 8px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--accent) 22%, transparent);
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
  .history {
    margin-top: 0.5rem;
  }
  .history > li {
    gap: 0.85rem;
    padding: 0.85rem 0.25rem;
  }
  .where-panel {
    flex-basis: 100%;
    margin: 0.25rem 0 0 calc(44px + 0.85rem);
    padding: 0.75rem 0.9rem;
    border-radius: 16px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    font-size: 0.85rem;
  }
  .where-panel p {
    margin: 0 0 0.35rem;
  }
  .where-panel ol {
    margin: 0;
    padding-left: 1.1rem;
    display: grid;
    gap: 0.25rem;
    color: var(--text-2);
  }
  .actions {
    gap: 0.4rem;
    flex: none;
  }
  .empty {
    margin: 1rem 0 0.5rem;
  }
  .bare {
    border-color: transparent !important;
    box-shadow: none !important;
    background: transparent;
  }
  .incoming {
    position: fixed;
    right: max(1.5rem, env(safe-area-inset-right));
    top: max(1.5rem, env(safe-area-inset-top));
    width: 22rem;
    max-width: calc(100% - 3rem);
    padding: 1.1rem;
    border-radius: 26px;
    z-index: 20;
    animation: drop-in 0.7s cubic-bezier(0.2, 0.9, 0.2, 1.1) both;
  }
  @keyframes drop-in {
    from {
      opacity: 0;
      transform: translateY(-20px) scale(0.96);
    }
  }
  @media (max-width: 640px) {
    .incoming {
      top: auto;
      bottom: max(1rem, env(safe-area-inset-bottom));
      right: 1rem;
      left: 1rem;
      width: auto;
      max-width: none;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .sheen {
      display: none;
    }
  }
</style>
