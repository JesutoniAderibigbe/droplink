<script lang="ts">
  import { auth, signOut } from '../lib/state/auth.svelte';
</script>

<main class="container stack">
  <h1>Signed in</h1>
  <p>{auth.session?.user.email}</p>
  <button onclick={signOut}>Sign out</button>
</main>
