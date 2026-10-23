<script lang="ts">
  import { transfers, clearHistory } from '../lib/state/transfers.svelte';
  import { formatBytes, timeAgo } from '../lib/core/format';
  import IncomingCard from '../components/IncomingCard.svelte';
  import FolderCard from '../components/FolderCard.svelte';

  let copied = $state<string | null>(null);
  async function copy(id: string, text: string) {
    await navigator.clipboard.writeText(text);
    copied = id;
    setTimeout(() => (copied = null), 2000);
  }
</script>

<main class="container stack">
  <h1>Received</h1>

  <FolderCard />

  {#each transfers.incoming as t (t.id)}
    <IncomingCard {t} />
  {/each}

  <section class="card stack" aria-labelledby="history-title">
    <div class="row spread">
      <h2 id="history-title">History on this device</h2>
      {#if transfers.received.length}<button class="link" onclick={clearHistory}>Clear</button>{/if}
    </div>
    {#if transfers.received.length === 0}
      <p class="muted">
        Nothing received yet. Files you send to this device from your other devices show up here.
      </p>
    {:else}
      <ul class="list">
        {#each transfers.received as r (r.transferId + r.fileId)}
          <li class="stack item">
            <div class="row">
              <span class="grow">
                <strong class="ellipsis name"
                  >{r.location === 'text' ? 'Shared text' : r.savedName}</strong
                >
                <small class="muted">
                  From {r.fromName} · {timeAgo(r.at)}{r.location !== 'text'
                    ? ` · ${formatBytes(r.size)}`
                    : ''}
                </small>
              </span>
            </div>
            {#if r.location === 'text' && r.text}
              <div class="text-item">
                <p class="text">{r.text}</p>
                <button onclick={() => copy(r.fileId, r.text!)}
                  >{copied === r.fileId ? 'Copied' : 'Copy'}</button
                >
                {#if /^https?:\/\/\S+$/.test(r.text.trim())}
                  <a class="button" href={r.text.trim()} target="_blank" rel="noopener noreferrer"
                    >Open link</a
                  >
                {/if}
              </div>
            {:else if r.location === 'folder'}
              <small class="muted"
                >Saved as “{r.savedName}” in your DropLink folder. Open the folder in Finder or
                Files to find it.</small
              >
            {:else}
              <small class="muted">Saved to your browser's Downloads folder.</small>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </section>
</main>

<style>
  .name {
    display: block;
  }
  .item {
    gap: 0.35rem;
  }
  .text-item {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    align-items: center;
  }
  .text {
    flex: 1 1 100%;
    margin: 0;
    padding: 0.6rem 0.75rem;
    background: var(--surface-2);
    border-radius: var(--radius-sm);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    font-family: var(--mono);
    font-size: 0.9rem;
  }
</style>
