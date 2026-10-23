<script lang="ts">
  import type { Snippet } from 'svelte';
  // The glossy "signal lamp": orange by default, green for success.
  let {
    size = 92,
    tone = 'orange',
    children,
  }: { size?: number; tone?: 'orange' | 'green'; children?: Snippet } = $props();
</script>

<div class="orb {tone}" style:width="{size}px" style:height="{size}px" aria-hidden="true">
  {#if children}{@render children()}{/if}
</div>

<style>
  .orb {
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #fff;
    flex: none;
    position: relative;
  }
  .orange {
    background: radial-gradient(
      circle at 34% 28%,
      #ffffff 0%,
      #ffd9c7 10%,
      #ff8a5c 30%,
      #e8400f 58%,
      #a82a05 92%
    );
    box-shadow:
      0 18px 36px rgba(232, 64, 15, 0.3),
      inset -8px -10px 22px rgba(120, 25, 0, 0.35);
  }
  .green {
    background: radial-gradient(
      circle at 34% 28%,
      #e9fbef 0%,
      #6fd69a 25%,
      #12a150 60%,
      #0a6b34 95%
    );
    box-shadow: 0 18px 40px rgba(18, 161, 80, 0.3);
  }
</style>
