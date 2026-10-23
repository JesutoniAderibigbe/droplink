<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from './Icon.svelte';
  let {
    title,
    subtitle,
    back = '/',
    right,
  }: { title: string; subtitle?: string; back?: string | null; right?: Snippet } = $props();
</script>

<header class="topbar">
  {#if back}
    <a class="button icon" href={back} aria-label="Back"><Icon name="back" stroke={2} /></a>
  {/if}
  <div class="grow">
    <h1>{title}</h1>
    {#if subtitle}<p class="muted sub">{subtitle}</p>{/if}
  </div>
  {#if right}{@render right()}{/if}
</header>

<style>
  .topbar {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin-bottom: 1.25rem;
  }
  h1 {
    font-size: 1.4rem;
    margin: 0;
  }
  .sub {
    margin: 0.1rem 0 0;
    font-size: 0.8rem;
  }
</style>
