<script lang="ts">
  import { folder, pickFolder, reallowFolder, clearFolder } from '../lib/state/folder.svelte';
  import { humanError } from '../lib/core/errors';
  import { detectKind } from '../lib/core/deviceName';

  let error = $state('');
  const isPhone = ['android', 'ios'].includes(
    detectKind({ userAgent: navigator.userAgent, maxTouchPoints: navigator.maxTouchPoints }),
  );

  async function run(fn: () => Promise<void>) {
    error = '';
    try {
      await fn();
    } catch (e) {
      error = humanError(e);
    }
  }
</script>

{#if folder.supported && !isPhone}
  <section class="card stack" aria-labelledby="folder-title">
    <h2 id="folder-title">Download folder</h2>
    {#if folder.permission === 'none'}
      <p class="muted">
        Pick a folder once and received files are saved straight into it, with no download prompts.
      </p>
      <div>
        <button class="primary" onclick={() => run(pickFolder)}>Choose download folder</button>
      </div>
    {:else if folder.permission === 'granted'}
      <p>Saving to <strong>{folder.name}</strong>.</p>
      <div class="row wrap">
        <button onclick={() => run(pickFolder)}>Change folder</button>
        <button class="link" onclick={() => run(clearFolder)}>Use browser downloads instead</button>
      </div>
    {:else}
      <p>
        Your browser needs permission again to save into <strong>{folder.name}</strong>. Until then,
        files go to your normal Downloads folder.
      </p>
      <p class="muted">
        Tip: choose “Allow on every visit” so you don't have to do this after restarting Chrome.
      </p>
      <div class="row wrap">
        <button class="primary" onclick={() => run(reallowFolder)}
          >Allow access to {folder.name}</button
        >
        <button onclick={() => run(pickFolder)}>Choose another folder</button>
      </div>
    {/if}
    {#if error}<p class="error" role="alert">{error}</p>{/if}
  </section>
{:else if !folder.supported && !isPhone}
  <section class="card soft" aria-label="Browser note">
    <p>
      Received files go to your browser's Downloads folder. For large files, and to save straight
      into a folder you choose, use <strong>Chrome</strong> or <strong>Edge</strong>.
    </p>
  </section>
{/if}
