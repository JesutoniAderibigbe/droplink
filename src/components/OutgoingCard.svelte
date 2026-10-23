<script lang="ts">
  import type { OutgoingView } from '../lib/services/transferEngine';
  import { cancelOutgoing, cancelOutgoingFile } from '../lib/state/transfers.svelte';
  import { formatBytes, plural } from '../lib/core/format';
  import Progress from './Progress.svelte';

  let { t }: { t: OutgoingView } = $props();

  let now = $state(Date.now());
  $effect(() => {
    if (!t.waitUntil) return;
    const timer = setInterval(() => (now = Date.now()), 250);
    return () => clearInterval(timer);
  });
  const secondsLeft = $derived(
    t.waitUntil ? Math.max(0, Math.ceil((t.waitUntil - now) / 1000)) : 0,
  );
  const active = $derived(
    !['delivered', 'relayed', 'partial', 'failed', 'cancelled'].includes(t.phase),
  );

  const phaseText: Record<OutgoingView['phase'], string> = {
    preparing: 'Preparing…',
    waiting: 'Waiting',
    connecting: 'Connecting…',
    sending: 'Sending',
    reconnecting: 'Reconnecting…',
    relaying: 'Encrypting and uploading',
    queued: 'Waiting for device',
    delivered: 'Delivered',
    relayed: 'Uploaded securely',
    partial: 'Partly delivered',
    failed: 'Not sent',
    cancelled: 'Cancelled',
  };
  const badge = $derived(
    t.phase === 'delivered' || t.phase === 'relayed'
      ? 'ok'
      : t.phase === 'failed'
        ? 'danger'
        : t.phase === 'partial' || t.phase === 'queued'
          ? 'warn'
          : '',
  );
</script>

<article class="card stack transfer" aria-label="Sending to {t.targetName}">
  <div class="row spread">
    <div class="grow">
      <strong class="ellipsis">To {t.targetName}</strong>
      <small class="muted">{plural(t.files.length, 'file')} · {formatBytes(t.totalBytes)}</small>
    </div>
    <span class="badge {badge}">{phaseText[t.phase]}</span>
  </div>

  {#if t.phase === 'waiting' && t.waitUntil}
    <p class="wait" aria-live="polite">{t.detail} <span class="muted">{secondsLeft} s</span></p>
  {:else if t.detail && t.phase !== 'delivered' && t.phase !== 'cancelled'}
    <p class="muted" aria-live="polite">{t.detail}</p>
  {/if}

  {#if active || t.phase === 'partial'}
    <Progress value={t.transferredBytes} max={t.totalBytes} label="Overall progress" />
  {/if}

  <ul class="list files">
    {#each t.files as f (f.id)}
      <li class="row">
        <span class="grow">
          <span class="ellipsis name">{f.name}</span>
          <small class="muted">
            {#if f.status === 'sending'}{formatBytes(f.transferred)} of {formatBytes(f.size)}
            {:else if f.status === 'done'}Sent · {formatBytes(f.size)}
            {:else if f.status === 'cancelled'}Cancelled
            {:else if f.status === 'failed'}{f.error ?? 'Failed'}
            {:else}{formatBytes(f.size)}{/if}
          </small>
          {#if f.status === 'sending'}<Progress
              value={f.transferred}
              max={f.size}
              label="Progress for {f.name}"
            />{/if}
        </span>
        {#if active && (f.status === 'queued' || f.status === 'sending') && t.files.length > 1}
          <button
            class="icon"
            aria-label="Cancel {f.name}"
            onclick={() => cancelOutgoingFile(t.id, f.id)}>✕</button
          >
        {/if}
      </li>
    {/each}
  </ul>

  {#if active}
    <div class="row">
      <button class="danger" onclick={() => cancelOutgoing(t.id)}>Cancel</button>
    </div>
  {/if}
</article>

<style>
  .name {
    display: block;
  }
  .wait {
    font-weight: 600;
    margin: 0;
  }
  .files > li {
    padding: 0.5rem 0;
  }
</style>
