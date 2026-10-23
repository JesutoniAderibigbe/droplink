<script lang="ts">
  import { install, promptInstall } from '../lib/state/install.svelte';
  import { settings, updateSettings } from '../lib/state/settings.svelte';
</script>

{#if !install.installed && !settings.dismissedInstallCard && (install.canPrompt || install.safari)}
  <section class="card soft stack" aria-labelledby="install-title">
    <h2 id="install-title">Install DropLink</h2>
    {#if install.canPrompt}
      <p>Install it as an app to get DropLink in your share sheet and open it in one tap.</p>
      <div class="row wrap">
        <button class="primary" onclick={promptInstall}>Install app</button>
        <button class="link" onclick={() => updateSettings({ dismissedInstallCard: true })}
          >Not now</button
        >
      </div>
    {:else if install.safari === 'mac'}
      <p>
        In Safari, choose <strong>File → Add to Dock</strong>. The Dock app can get notifications
        when files are waiting, even with Safari closed.
      </p>
      <div>
        <button class="link" onclick={() => updateSettings({ dismissedInstallCard: true })}
          >Got it</button
        >
      </div>
    {:else}
      <p>Tap the <strong>Share</strong> button, then <strong>Add to Home Screen</strong>.</p>
      <div>
        <button class="link" onclick={() => updateSettings({ dismissedInstallCard: true })}
          >Got it</button
        >
      </div>
    {/if}
  </section>
{/if}
