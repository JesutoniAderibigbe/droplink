<script lang="ts">
  import type { DeviceRow } from '../lib/core/types';
  import DeviceIcon from './DeviceIcon.svelte';

  let {
    devices,
    selected = $bindable(),
    isOnline,
  }: {
    devices: DeviceRow[];
    selected: string | null;
    isOnline: (id: string) => boolean;
  } = $props();

  const sorted = $derived(
    devices.toSorted((a, b) => Number(isOnline(b.id)) - Number(isOnline(a.id))),
  );
</script>

<fieldset class="picker">
  <legend>Send to</legend>
  {#if devices.length === 0}
    <p class="muted">
      No other devices yet. Sign in to DropLink on your other phone or computer with the same
      account.
    </p>
  {/if}
  {#each sorted as d (d.id)}
    {@const online = isOnline(d.id)}
    <label class="option" class:checked={selected === d.id}>
      <input type="radio" name="target" value={d.id} bind:group={selected} />
      <DeviceIcon kind={d.kind} />
      <span class="grow ellipsis">{d.name}</span>
      {#if online}<span class="badge ok"><span class="dot"></span>Online</span>{:else}<span
          class="badge">Offline</span
        >{/if}
    </label>
  {/each}
</fieldset>

<style>
  .picker {
    border: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.5rem;
  }
  legend {
    font-weight: 600;
    margin-bottom: 0.5rem;
    padding: 0;
  }
  .option {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    min-height: 56px;
    padding: 0.5rem 0.85rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    cursor: pointer;
    font-weight: 500;
    margin: 0;
  }
  .option.checked {
    border-color: var(--accent);
    background: var(--accent-soft);
  }
  .option input {
    width: 1.15rem;
    height: 1.15rem;
    accent-color: var(--accent);
    margin: 0;
  }
  .option:focus-within {
    outline: 3px solid var(--focus);
    outline-offset: 2px;
  }
</style>
