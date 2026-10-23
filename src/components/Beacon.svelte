<script lang="ts">
  import Orb from './Orb.svelte';
  // Floating orb with pulse rings, a dashed orbit with a satellite dot, and a
  // contact shadow that shrinks as it rises. All loops stop under reduced motion.
  let { size = 150, orbit = true }: { size?: number; orbit?: boolean } = $props();
  const ring = $derived(Math.round(size * 1.47));
</script>

<div class="beacon" style:--ring="{ring}px" style:height="{ring + 60}px" aria-hidden="true">
  <div class="shadow" style:top="{ring / 2 + size / 2 + 40}px"></div>
  <div class="float">
    <div class="ring"></div>
    <div class="ring r2"></div>
    <div class="ring r3"></div>
    {#if orbit}
      <div class="orbit"><span class="sat"></span></div>
    {/if}
    <div class="center"><Orb {size} /></div>
    <div class="spec" style:width="{size * 0.3}px" style:height="{size * 0.13}px"></div>
  </div>
</div>

<style>
  .beacon {
    position: relative;
    width: 100%;
  }
  .float,
  .center {
    position: absolute;
    inset: 0;
  }
  .float {
    animation: b-float 6s ease-in-out infinite;
  }
  .center {
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .ring,
  .orbit {
    position: absolute;
    left: 50%;
    top: 50%;
    width: var(--ring);
    height: var(--ring);
    border-radius: 50%;
  }
  .ring {
    border: 1.5px solid rgba(232, 64, 15, 0.35);
    transform: translate(-50%, -50%) scale(0.55);
    opacity: 0;
    animation: b-pulse 3s ease-out infinite both;
  }
  .r2 {
    animation-delay: 1s;
  }
  .r3 {
    animation-delay: 2s;
  }
  .orbit {
    margin: calc(var(--ring) / -2) 0 0 calc(var(--ring) / -2);
    border: 1px dashed var(--border-strong);
    animation: b-spin 12s linear infinite;
  }
  .sat {
    position: absolute;
    left: 50%;
    top: -6px;
    width: 12px;
    height: 12px;
    margin-left: -6px;
    border-radius: 50%;
    background: var(--ink);
    box-shadow: 0 0 0 4px var(--surface);
  }
  .spec {
    position: absolute;
    left: 50%;
    top: 50%;
    margin: -14% 0 0 -12%;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.7);
    filter: blur(5px);
    transform: rotate(-24deg);
  }
  .shadow {
    position: absolute;
    left: 50%;
    width: 130px;
    height: 18px;
    border-radius: 50%;
    background: radial-gradient(ellipse, rgba(17, 19, 24, 0.28), rgba(17, 19, 24, 0) 70%);
    animation: b-shadow 6s ease-in-out infinite;
    transform: translateX(-50%);
  }
  @keyframes b-float {
    0%,
    100% {
      transform: translateY(0);
    }
    50% {
      transform: translateY(-12px);
    }
  }
  @keyframes b-shadow {
    0%,
    100% {
      transform: translateX(-50%) scale(1);
      opacity: 0.55;
    }
    50% {
      transform: translateX(-50%) scale(0.82);
      opacity: 0.35;
    }
  }
  @keyframes b-pulse {
    0% {
      transform: translate(-50%, -50%) scale(0.55);
      opacity: 0.9;
    }
    100% {
      transform: translate(-50%, -50%) scale(1.9);
      opacity: 0;
    }
  }
  @keyframes b-spin {
    to {
      transform: rotate(360deg);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .float,
    .shadow,
    .ring,
    .orbit {
      animation: none;
    }
    .ring {
      opacity: 0;
    }
  }
</style>
