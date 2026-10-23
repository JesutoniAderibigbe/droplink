<script lang="ts">
  let { value, max, label }: { value: number; max: number; label: string } = $props();
  const pct = $derived(max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0);
</script>

<div
  class="progress"
  role="progressbar"
  aria-label={label}
  aria-valuemin={0}
  aria-valuemax={100}
  aria-valuenow={pct}
>
  <div class="bar" style:width="{pct}%"></div>
</div>

<style>
  .progress {
    height: 6px;
    border-radius: 999px;
    background: var(--surface-2);
    overflow: hidden;
  }
  .bar {
    height: 100%;
    background: var(--accent);
    border-radius: inherit;
    transition: width var(--dur) linear;
  }
</style>
