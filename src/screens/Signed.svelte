<script lang="ts">
  import { auth } from '../lib/state/auth.svelte';
  import { router } from '../lib/state/router.svelte';
  import { session, startSession } from '../lib/state/session.svelte';
  import AppHeader from '../components/AppHeader.svelte';
  import Home from './Home.svelte';
  import Settings from './Settings.svelte';

  $effect(() => {
    const id = auth.session?.user.id;
    if (id) void startSession(id);
  });
</script>

<AppHeader />

{#if session.phase === 'error'}
  <main class="container stack">
    <div class="card warn stack" role="alert">
      <h2>Couldn't set up this device</h2>
      <p>{session.error}</p>
      <button onclick={() => auth.session && startSession(auth.session.user.id)}>Try again</button>
    </div>
  </main>
{:else if session.phase !== 'ready'}
  <p class="container muted" aria-live="polite">Setting up this device…</p>
{:else if router.route === 'home'}
  <Home />
{:else if router.route === 'settings'}
  <Settings />
{:else}
  <main class="container stack">
    <h1>Page not found</h1>
    <p><a href="/">Go home</a></p>
  </main>
{/if}
