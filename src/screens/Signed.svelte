<script lang="ts">
  import { auth } from '../lib/state/auth.svelte';
  import { router } from '../lib/state/router.svelte';
  import { session, startSession } from '../lib/state/session.svelte';
  import '../lib/state/contacts.svelte';
  import '../lib/state/presence.svelte';
  import '../lib/state/transfers.svelte';
  import '../lib/state/settings.svelte';
  import '../lib/state/arrivals.svelte';
  import '../lib/state/push.svelte';
  import '../lib/state/relay.svelte';
  import Toasts from '../components/Toasts.svelte';
  import Home from './Home.svelte';
  import Settings from './Settings.svelte';
  import Send from './Send.svelte';
  import Receive from './Receive.svelte';
  import People from './People.svelte';

  $effect(() => {
    const id = auth.session?.user.id;
    if (id) void startSession(id);
  });
</script>

<Toasts />

{#if session.phase === 'error'}
  <main id="main" tabindex="-1" class="container stack">
    <div class="card warn stack" role="alert">
      <h2>Couldn't set up this device</h2>
      <p>{session.error}</p>
      <button onclick={() => auth.session && startSession(auth.session.user.id)}>Try again</button>
    </div>
  </main>
{:else if session.phase !== 'ready'}
  <p class="container muted setup" aria-live="polite">Setting up this device…</p>
{:else if router.route === 'home'}
  <Home />
{:else if router.route === 'settings'}
  <Settings />
{:else if router.route === 'send'}
  <Send />
{:else if router.route === 'receive'}
  <Receive />
{:else if router.route === 'people'}
  <People />
{:else}
  <main id="main" tabindex="-1" class="container stack">
    <h1>Page not found</h1>
    <p><a href="/">Go home</a></p>
  </main>
{/if}
