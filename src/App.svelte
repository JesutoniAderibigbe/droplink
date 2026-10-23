<script lang="ts">
  import { auth } from './lib/state/auth.svelte';
  import { router, handleLinkClick } from './lib/state/router.svelte';
  import Landing from './screens/Landing.svelte';
  import Privacy from './screens/Privacy.svelte';
  import Terms from './screens/Terms.svelte';
  import Signed from './screens/Signed.svelte';
</script>

<svelte:document onclick={handleLinkClick} />

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
