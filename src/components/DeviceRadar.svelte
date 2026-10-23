<script lang="ts">
  import type { DeviceKind, DeviceRow } from '../lib/core/types';
  import Icon from './Icon.svelte';
  import Orb from './Orb.svelte';

  // Home "device radar": this device in the middle, the others orbiting it.
  // It's a real list (screen readers hear names and status), drawn as a radar.
  let {
    selfKind,
    devices,
    isOnline,
  }: { selfKind: DeviceKind; devices: DeviceRow[]; isOnline: (id: string) => boolean } = $props();

  const iconFor = (k: DeviceKind) =>
    k === 'android' || k === 'ios'
      ? 'phone'
      : k === 'windows' || k === 'linux'
        ? 'desktop'
        : 'laptop';
  const shown = $derived(devices.slice(0, 8));
  const R = 150; // orbit radius (px)
  // Start top-right like the design, spread evenly.
  const pos = (i: number, n: number) => {
    const a = ((-55 + (360 / Math.max(n, 1)) * i) * Math.PI) / 180;
    return { x: R + R * Math.cos(a), y: R + R * Math.sin(a) };
  };
</script>

<div class="radar">
  <div class="disc" aria-hidden="true"></div>
  <div class="inner" aria-hidden="true"></div>
  <div class="sweep" aria-hidden="true"></div>
  <div class="pulse" aria-hidden="true"></div>
  <div class="pulse p2" aria-hidden="true"></div>
  <div class="pulse p3" aria-hidden="true"></div>
  <div class="me"><Orb size={92}><Icon name={iconFor(selfKind)} size={30} /></Orb></div>

  <ul class="orbit" aria-label="Your devices">
    {#each shown as d, i (d.id)}
      {@const p = pos(i, shown.length)}
      {@const online = isOnline(d.id)}
      <li class="sat" class:online style:left="{p.x}px" style:top="{p.y}px">
        <div class="upright">
          <div class="tile">
            <Icon name={iconFor(d.kind)} size={online ? 26 : 22} />
            {#if online}<span class="live-dot live"></span>{/if}
          </div>
          <span class="name">{d.name}</span>
          <span class="sr-only">{online ? 'Online' : 'Offline'}</span>
        </div>
      </li>
    {/each}
  </ul>
</div>

<style>
  .radar {
    position: relative;
    width: 300px;
    height: 330px;
    margin: 0 auto;
    max-width: 100%;
  }
  .disc,
  .inner,
  .sweep,
  .pulse,
  .me,
  .orbit {
    position: absolute;
    left: 50%;
    top: 50%;
  }
  .disc,
  .sweep,
  .orbit {
    width: 300px;
    height: 300px;
    margin: -150px 0 0 -150px;
    border-radius: 50%;
  }
  .disc {
    border: 1px solid var(--border);
    background: color-mix(in srgb, var(--surface) 35%, transparent);
  }
  .inner {
    width: 200px;
    height: 200px;
    margin: -100px 0 0 -100px;
    border-radius: 50%;
    border: 1px dashed var(--border-strong);
  }
  .sweep {
    background: conic-gradient(
      from 0deg,
      rgba(232, 64, 15, 0.16),
      rgba(232, 64, 15, 0) 22%,
      rgba(0, 0, 0, 0)
    );
    animation: r-spin 5s linear infinite;
  }
  .pulse {
    width: 260px;
    height: 260px;
    border-radius: 50%;
    border: 1px solid rgba(232, 64, 15, 0.35);
    transform: translate(-50%, -50%) scale(0.4);
    opacity: 0;
    animation: r-pulse 3.2s ease-out infinite both;
  }
  .p2 {
    animation-delay: 1.06s;
  }
  .p3 {
    animation-delay: 2.13s;
  }
  .me {
    transform: translate(-50%, -50%);
  }
  .orbit {
    list-style: none;
    padding: 0;
    animation: r-spin 40s linear infinite;
  }
  .sat {
    position: absolute;
    transform: translate(-50%, -50%);
  }
  .upright {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    animation: r-counter 40s linear infinite;
    opacity: 0.6;
  }
  .online .upright {
    opacity: 1;
  }
  .tile {
    position: relative;
    width: 50px;
    height: 50px;
    border-radius: 18px;
    background: var(--surface);
    border: 1px solid var(--border);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text);
  }
  .online .tile {
    width: 58px;
    height: 58px;
    border-radius: 20px;
    box-shadow: 0 10px 24px rgba(17, 19, 24, 0.1);
  }
  .live-dot {
    position: absolute;
    right: -3px;
    top: -3px;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--ok);
    border: 2px solid var(--surface);
  }
  .name {
    font-size: 12px;
    font-weight: 500;
    white-space: nowrap;
    max-width: 110px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .online .name {
    font-weight: 600;
  }
  @keyframes r-spin {
    to {
      transform: rotate(360deg);
    }
  }
  @keyframes r-counter {
    to {
      transform: rotate(-360deg);
    }
  }
  @keyframes r-pulse {
    0% {
      transform: translate(-50%, -50%) scale(0.4);
      opacity: 0.9;
    }
    100% {
      transform: translate(-50%, -50%) scale(1.6);
      opacity: 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .sweep,
    .pulse,
    .orbit,
    .upright {
      animation: none;
    }
    .pulse {
      opacity: 0;
    }
  }
</style>
