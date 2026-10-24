<script lang="ts">
  import { viewKind } from '../lib/services/receivedFiles';
  import Icon from './Icon.svelte';

  // Full-screen viewer for received photos, videos and audio.
  let { file, onclose, onshare }: { file: File; onclose: () => void; onshare?: () => void } =
    $props();

  const kind = $derived(viewKind(file));
  let url = $state('');
  $effect(() => {
    const u = URL.createObjectURL(file);
    url = u;
    return () => URL.revokeObjectURL(u);
  });

  let closeBtn: HTMLButtonElement | undefined = $state();
  $effect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeBtn?.focus();
    return () => previous?.focus();
  });
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onclose()} />

<div class="viewer" role="dialog" aria-modal="true" aria-label={file.name}>
  <header class="row">
    <span class="grow ellipsis name">{file.name}</span>
    {#if onshare}
      <button class="pill on-dark" onclick={onshare}>Share</button>
    {/if}
    <button class="icon on-dark" aria-label="Close" bind:this={closeBtn} onclick={onclose}>
      <Icon name="x" />
    </button>
  </header>
  <div class="stage">
    {#if url}
      {#if kind === 'image'}
        <img src={url} alt={file.name} />
      {:else if kind === 'video'}
        <!-- svelte-ignore a11y_media_has_caption -->
        <video src={url} controls autoplay playsinline></video>
      {:else if kind === 'audio'}
        <audio src={url} controls autoplay></audio>
      {/if}
    {/if}
  </div>
</div>

<style>
  .viewer {
    position: fixed;
    inset: 0;
    z-index: 60;
    background: rgba(10, 11, 14, 0.94);
    color: #fff;
    display: flex;
    flex-direction: column;
    padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom)
      env(safe-area-inset-left);
    animation: fade 0.2s ease-out;
  }
  header {
    gap: 0.5rem;
    padding: 0.75rem 1rem;
  }
  .name {
    font-weight: 600;
  }
  .on-dark {
    background: rgba(255, 255, 255, 0.1);
    border-color: rgba(255, 255, 255, 0.2);
    color: #fff;
    box-shadow: none;
  }
  .stage {
    flex: 1;
    min-height: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0 1rem 1rem;
  }
  img,
  video {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
    border-radius: 12px;
  }
  audio {
    width: min(32rem, 100%);
  }
  @keyframes fade {
    from {
      opacity: 0;
    }
  }
</style>
