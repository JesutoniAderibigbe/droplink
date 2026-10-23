<script lang="ts">
  import { toasts, dismiss } from '../lib/state/toasts.svelte';
</script>

<div class="toasts" role="status" aria-live="polite">
  {#each toasts.list as t (t.id)}
    <div class="toast {t.kind}">
      <span class="grow">{t.text}</span>
      {#if t.action}<a href={t.action.href} onclick={() => dismiss(t.id)}>{t.action.label}</a>{/if}
      <button class="icon close" aria-label="Dismiss" onclick={() => dismiss(t.id)}>✕</button>
    </div>
  {/each}
</div>

<style>
  .toasts {
    position: fixed;
    inset-inline: 0;
    bottom: calc(1rem + env(safe-area-inset-bottom));
    display: grid;
    justify-items: center;
    gap: 0.5rem;
    padding: 0 1rem;
    z-index: 50;
    pointer-events: none;
  }
  .toast {
    pointer-events: auto;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    width: min(28rem, 100%);
    padding: 0.5rem 0.5rem 0.5rem 1rem;
    border-radius: var(--radius);
    background: var(--text);
    color: var(--bg);
    box-shadow: 0 6px 24px rgb(0 0 0 / 25%);
    animation: rise var(--dur) ease-out;
  }
  .toast a {
    color: inherit;
    font-weight: 600;
  }
  .toast.error {
    background: var(--danger);
    color: var(--danger-text);
  }
  .close {
    background: transparent;
    border: none;
    color: inherit;
    min-height: 36px;
    min-width: 36px;
  }
  @keyframes rise {
    from {
      transform: translateY(8px);
      opacity: 0;
    }
  }
</style>
