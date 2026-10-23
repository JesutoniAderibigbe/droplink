<script lang="ts">
  import type { SendFile } from '../lib/core/sink';
  import { formatBytes, plural } from '../lib/core/format';
  import { otherDevices } from '../lib/state/session.svelte';
  import { isOnline } from '../lib/state/presence.svelte';
  import { transfers, sendFiles, toSendFiles } from '../lib/state/transfers.svelte';
  import { settings, preferredTarget, updateSettings } from '../lib/state/settings.svelte';
  import DevicePicker from '../components/DevicePicker.svelte';
  import OutgoingCard from '../components/OutgoingCard.svelte';

  let files = $state<SendFile[]>([]);
  let dragging = $state(false);
  let input: HTMLInputElement | undefined = $state();

  const devices = $derived(otherDevices());
  let target = $state<string | null>(null);
  // Preselect: default device, else most recently used, else the first online one.
  $effect(() => {
    if (target && devices.some((d) => d.id === target)) return;
    const ids = devices.map((d) => d.id);
    target = preferredTarget(ids) ?? devices.find((d) => isOnline(d.id))?.id ?? ids[0] ?? null;
  });

  const totalBytes = $derived(files.reduce((s, f) => s + f.size, 0));

  function addFiles(list: FileList | null | undefined) {
    if (!list?.length) return;
    files = [...files, ...toSendFiles(list)];
  }

  function remove(id: string) {
    files = files.filter((f) => f.id !== id);
  }

  function send() {
    if (!target || files.length === 0) return;
    sendFiles(target, files);
    void updateSettings({ lastTargetId: target });
    files = [];
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    dragging = false;
    addFiles(e.dataTransfer?.files);
  }
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

<main class="container stack">
  <h1>Send</h1>

  <section class="card stack" aria-labelledby="files-title">
    <div class="row spread">
      <h2 id="files-title">Files</h2>
      {#if files.length}<small class="muted"
          >{plural(files.length, 'file')} · {formatBytes(totalBytes)}</small
        >{/if}
    </div>

    <div class="drop" class:dragging>
      <p>
        <button class="primary" onclick={() => input?.click()}>Choose files</button>
        <span class="muted hide-touch">or drop them anywhere on this page</span>
      </p>
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

    {#if files.length}
      <ul class="list" aria-label="Selected files">
        {#each files as f (f.id)}
          <li class="row">
            <span class="grow ellipsis">{f.name}</span>
            <small class="muted">{formatBytes(f.size)}</small>
            <button class="icon" aria-label="Remove {f.name}" onclick={() => remove(f.id)}>✕</button
            >
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <section class="card stack">
    <DevicePicker {devices} bind:selected={target} {isOnline} />
    <button class="primary big" disabled={!target || files.length === 0} onclick={send}>
      {files.length ? `Send ${plural(files.length, 'file')}` : 'Send'}
    </button>
    {#if settings.defaultTargetId === null && target}
      <button class="link" onclick={() => updateSettings({ defaultTargetId: target })}
        >Make this my default device</button
      >
    {/if}
  </section>

  {#if transfers.outgoing.length}
    <section class="stack" aria-labelledby="outgoing-title">
      <h2 id="outgoing-title">Sending</h2>
      {#each transfers.outgoing as t (t.id)}
        <OutgoingCard {t} />
      {/each}
    </section>
  {/if}
</main>

<style>
  .drop {
    border: 2px dashed var(--border);
    border-radius: var(--radius);
    padding: 1.25rem;
    text-align: center;
    transition:
      border-color var(--dur),
      background var(--dur);
  }
  .drop.dragging {
    border-color: var(--accent);
    background: var(--accent-soft);
  }
  .drop p {
    margin: 0;
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    align-items: center;
    gap: 0.75rem;
  }
  @media (pointer: coarse) {
    .hide-touch {
      display: none;
    }
  }
</style>
