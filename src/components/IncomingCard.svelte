<script lang="ts">
  import type { IncomingView } from '../lib/services/transferEngine';
  import { cancelIncomingFile } from '../lib/state/transfers.svelte';
  import { formatBytes, plural } from '../lib/core/format';
  import Progress from './Progress.svelte';

  let { t }: { t: IncomingView } = $props();
  const received = $derived(
    t.files.reduce((s, f) => s + (f.status === 'done' ? f.size : f.received), 0),
  );
  const active = $derived(
    t.phase === 'connecting' || t.phase === 'receiving' || t.phase === 'reconnecting',
  );
  const label: Record<IncomingView['phase'], string> = {
    connecting: 'Connecting…',
    receiving: 'Receiving',
    reconnecting: 'Reconnecting…',
    done: 'Received',
    failed: 'Failed',
    cancelled: 'Cancelled',
  };
</script>

<article class="card stack" aria-label="Receiving from {t.fromName}">
  <div class="row spread">
    <div class="grow">
      <strong class="ellipsis">From {t.fromName}</strong>
      <small class="muted"
        >{plural(t.fileCount, 'file')} · {formatBytes(t.totalBytes)}{t.via === 'relay'
          ? ' · encrypted relay'
          : ''}</small
      >
    </div>
    <span class="badge {t.phase === 'done' ? 'ok' : t.phase === 'failed' ? 'danger' : ''}"
      >{label[t.phase]}</span
    >
  </div>
  {#if active}
    <Progress value={received} max={t.totalBytes} label="Receiving progress" />
  {/if}
  {#if t.files.length}
    <ul class="list">
      {#each t.files as f (f.id)}
        <li class="row">
          <span class="grow">
            <span class="ellipsis name">{f.saved?.savedName ?? f.name}</span>
            <small class="muted">
              {#if f.status === 'receiving'}{formatBytes(f.received)} of {formatBytes(f.size)}
              {:else if f.status === 'done'}{f.saved?.location === 'folder'
                  ? 'Saved to your folder'
                  : f.saved?.location === 'text'
                    ? 'Text'
                    : 'Downloaded'} · {formatBytes(f.size)}{#if f.checksumOk === true}
                  · ✓ checksum{/if}{#if f.checksumOk === false}
                  · ⚠ checksum mismatch{/if}
              {:else if f.status === 'cancelled'}Cancelled
              {:else}{f.error ?? 'Failed'}{/if}
            </small>
          </span>
          {#if f.status === 'receiving' && t.via === 'p2p'}
            <button
              class="icon"
              aria-label="Cancel {f.name}"
              onclick={() => cancelIncomingFile(t.id, f.id)}>✕</button
            >
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</article>

<style>
  .name {
    display: block;
  }
</style>
