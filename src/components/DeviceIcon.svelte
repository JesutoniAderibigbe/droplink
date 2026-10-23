<script lang="ts">
  import type { DeviceKind } from '../lib/core/types';
  let { kind, size = 28 }: { kind: DeviceKind; size?: number } = $props();
  const phone = $derived(kind === 'android' || kind === 'ios');
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="1.8"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  {#if phone}
    <rect x="6.5" y="2.5" width="11" height="19" rx="2.5" />
    <path d="M11 18.5h2" />
  {:else}
    <rect x="3" y="4" width="18" height="12" rx="2" />
    <path d="M1.5 20h21" />
  {/if}
</svg>
