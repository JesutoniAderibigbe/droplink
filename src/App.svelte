<script lang="ts">
  import { auth } from './lib/state/auth.svelte';
  import { router, handleLinkClick } from './lib/state/router.svelte';
  import Landing from './screens/Landing.svelte';
  import Privacy from './screens/Privacy.svelte';
  import Terms from './screens/Terms.svelte';
  import Signed from './screens/Signed.svelte';
  import { tick } from 'svelte';

  // Client-side navigation doesn't announce anything to screen readers, so
  // move focus to the new page's heading (skipped on the very first load).
  let first = true;
  $effect(() => {
    void router.route;
    void router.query;
    if (first) {
      first = false;
      return;
    }
    void tick().then(() => {
      const h1 = document.querySelector<HTMLElement>('main h1');
      if (!h1) return;
      h1.tabIndex = -1;
      h1.focus({ preventScroll: true });
    });
  });
</script>

<svelte:document onclick={handleLinkClick} />

<a
  class="skip-link"
  href="#main"
  onclick={(e) => (e.preventDefault(), document.querySelector('main')?.focus())}>Skip to content</a
>

{#if router.route === 'privacy'}
  <Privacy />
{:else if router.route === 'terms'}
  <Terms />
{:else if !auth.ready}
  <p class="container muted" aria-live="polite">Loading…</p>
{:else if !auth.session}
  <Landing />
{:else}
  <Signed />
{/if}
