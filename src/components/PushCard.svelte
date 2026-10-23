<script lang="ts">
  import { push, turnOnNotifications } from '../lib/state/push.svelte';
  import { settings, updateSettings } from '../lib/state/settings.svelte';
  import { humanError } from '../lib/core/errors';

  let busy = $state(false);
  let error = $state('');

  async function enable() {
    busy = true;
    error = '';
    try {
      await turnOnNotifications();
    } catch (e) {
      error = humanError(e);
    } finally {
      busy = false;
    }
  }
</script>

{#if settings.loaded && push.permission === 'default' && !settings.dismissedPushCard}
  <section class="card soft stack" aria-labelledby="push-title">
    <h2 id="push-title">Get notified when files are on the way</h2>
    <p>
      If DropLink isn't open on this device when your other device sends something, we'll show a
      notification. Tap it and the transfer starts. Nothing else, no marketing.
    </p>
    <div class="row wrap">
      <button class="primary" onclick={enable} disabled={busy}>Turn on notifications</button>
      <button class="link" onclick={() => updateSettings({ dismissedPushCard: true })}
        >Not now</button
      >
    </div>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
  </section>
{:else if push.permission === 'denied' && !settings.dismissedPushCard}
  <section class="card warn stack" aria-label="Notifications blocked">
    <p>
      Notifications are blocked for DropLink, so this device can't be woken up when files arrive.
      You can allow them in your browser's site settings.
    </p>
    <div>
      <button class="link" onclick={() => updateSettings({ dismissedPushCard: true })}
        >Dismiss</button
      >
    </div>
  </section>
{/if}
