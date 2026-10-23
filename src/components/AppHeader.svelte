<script lang="ts">
  import { router } from '../lib/state/router.svelte';
</script>

<header class="app-header">
  <nav class="container row spread" aria-label="Main">
    <a href="/" class="brand row" aria-current={router.route === 'home' ? 'page' : undefined}>
      <img src="/icons/icon.svg" alt="" width="28" height="28" />
      <span>DropLink</span>
    </a>
    <div class="row">
      <a class="navlink" href="/send" aria-current={router.route === 'send' ? 'page' : undefined}
        >Send</a
      >
      <a
        class="navlink"
        href="/receive"
        aria-current={router.route === 'receive' ? 'page' : undefined}>Received</a
      >
      <a
        class="navlink"
        href="/settings"
        aria-current={router.route === 'settings' ? 'page' : undefined}>Settings</a
      >
    </div>
  </nav>
</header>

<style>
  .app-header {
    position: sticky;
    top: 0;
    z-index: 10;
    background: color-mix(in srgb, var(--bg) 88%, transparent);
    backdrop-filter: blur(8px);
    border-bottom: 1px solid var(--border);
  }
  nav {
    padding-block: 0.5rem;
  }
  .brand {
    font-weight: 700;
    color: var(--text);
    text-decoration: none;
    font-size: 1.05rem;
  }
  .brand img {
    border-radius: 7px;
  }
  .navlink {
    color: var(--text-2);
    text-decoration: none;
    padding: 0.5rem 0.55rem;
    border-radius: var(--radius-sm);
    font-size: 0.95rem;
  }
  .navlink[aria-current='page'] {
    color: var(--accent);
    background: var(--accent-soft);
  }
</style>
