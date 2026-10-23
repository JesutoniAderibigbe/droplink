<script lang="ts">
  import type { DeviceRow } from '../lib/core/types';
  import { timeAgo } from '../lib/core/format';
  import DeviceIcon from './DeviceIcon.svelte';

  let {
    devices,
    isOnline,
    emptyText = 'No other devices yet.',
  }: { devices: DeviceRow[]; isOnline: (id: string) => boolean; emptyText?: string } = $props();
</script>

{#if devices.length === 0}
  <p class="muted">{emptyText}</p>
{:else}
  <ul class="list" aria-label="Your devices">
    {#each devices as d (d.id)}
      {@const online = isOnline(d.id)}
      <li class="row">
        <span class="icon" class:online><DeviceIcon kind={d.kind} /></span>
        <span class="grow">
          <span class="name ellipsis">{d.name}</span>
          <small class="muted"
            >{online ? 'Online now' : `Last seen ${timeAgo(d.last_seen_at)}`}</small
          >
        </span>
        {#if online}
          <span class="badge ok"><span class="dot"></span>Online</span>
        {:else}
          <span class="badge">Offline</span>
        {/if}
      </li>
    {/each}
  </ul>
{/if}

<style>
  .icon {
    color: var(--text-2);
    display: inline-flex;
  }
  .icon.online {
    color: var(--ok);
  }
  .name {
    display: block;
    font-weight: 600;
  }
</style>
