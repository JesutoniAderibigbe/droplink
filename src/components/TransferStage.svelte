<script lang="ts">
  import { TRANSFER, LIMITS } from '../lib/config';
  import { formatBytes } from '../lib/core/format';
  import type { OutgoingView } from '../lib/services/transferEngine';
  import { settings } from '../lib/state/settings.svelte';
  import Icon from './Icon.svelte';
  import Orb from './Orb.svelte';

  // The big visual for one send, from the Signal design:
  // waiting (countdown + route checklist) → beaming (packets on a beam) →
  // landed (green burst) or parked in the encrypted relay.
  let { t }: { t: OutgoingView } = $props();

  let now = $state(Date.now());
  $effect(() => {
    const timer = setInterval(() => (now = Date.now()), 250);
    return () => clearInterval(timer);
  });

  const secondsLeft = $derived(
    t.waitUntil ? Math.max(0, Math.ceil((t.waitUntil - now) / 1000)) : 0,
  );
  const ringOffset = $derived(
    t.waitUntil ? 603 * (1 - Math.min(1, (t.waitUntil - now) / TRANSFER.waitForTargetMs)) : 0,
  );

  // Live speed (smoothed) and time left while bytes are moving.
  let last: { bytes: number; at: number } | null = null;
  let speed = $state(0);
  $effect(() => {
    const bytes = t.transferredBytes;
    const at = Date.now();
    if (last && at > last.at && bytes >= last.bytes) {
      const inst = ((bytes - last.bytes) / (at - last.at)) * 1000;
      speed = speed ? speed * 0.7 + inst * 0.3 : inst;
    }
    last = { bytes, at };
  });
  const eta = $derived(speed > 0 ? Math.ceil((t.totalBytes - t.transferredBytes) / speed) : null);
  const etaText = $derived(
    eta === null
      ? ''
      : eta < 60
        ? `about ${Math.max(1, eta)} s left`
        : `about ${Math.ceil(eta / 60)} min left`,
  );

  const relayEligible = $derived(
    settings.relayEnabled && t.totalBytes <= LIMITS.relayBytesPerTransfer,
  );
  const moving = $derived(['connecting', 'sending', 'reconnecting', 'relaying'].includes(t.phase));
</script>

{#if t.phase === 'waiting' || t.phase === 'preparing'}
  <section class="stage" aria-live="polite">
    <div class="glow-spot" style:top="-30px" style:width="420px" style:height="420px"></div>
    <div class="dial">
      <div class="wave"></div>
      <div class="wave w2"></div>
      <svg width="220" height="220" viewBox="0 0 220 220" class="ring" aria-hidden="true">
        <circle cx="110" cy="110" r="96" fill="none" stroke="var(--track)" stroke-width="6" />
        <circle
          cx="110"
          cy="110"
          r="96"
          fill="none"
          stroke="var(--accent)"
          stroke-width="6"
          stroke-linecap="round"
          stroke-dasharray="603"
          stroke-dashoffset={ringOffset}
        />
      </svg>
      <div class="face">
        <span class="bell"><Icon name="bell" size={32} /></span>
        <span class="secs">{secondsLeft}s</span>
      </div>
    </div>
    <h2 class="headline">
      Knocking on {t.targetName}<span class="dots"><i>.</i><i>.</i><i>.</i></span>
    </h2>
    <p class="muted lede">
      We sent a notification. Open it on {t.targetName} and the files beam straight over.
    </p>
    <span class="sr-only">{t.detail}</span>

    <ol class="card steps">
      <li>
        <span class="step-dot done-x"><Icon name="x" size={13} stroke={2.4} /></span>
        <span
          ><strong>Direct link</strong><small class="block"
            >{t.targetName} isn't open right now</small
          ></span
        >
      </li>
      <li>
        <span class="step-dot active"><span class="pulse-dot"></span></span>
        <span
          ><strong>Notification sent</strong><small class="block">Waiting for it to be opened</small
          ></span
        >
      </li>
      <li>
        <span class="step-dot later"><Icon name="lock" size={13} stroke={2} /></span>
        <span>
          <strong class="dim">Encrypted relay</strong>
          <small class="block">
            {relayEligible
              ? 'If no answer, we lock it and park it for 24 h'
              : settings.relayEnabled
                ? 'Too big for the relay (100 MB): it waits until the device is online'
                : 'Relay is off in Settings: it waits until the device is online'}
          </small>
        </span>
      </li>
    </ol>
  </section>
{:else if moving}
  <section class="card beam-card" aria-live="polite">
    <div class="beam-row" aria-hidden="true">
      <Orb size={56}><Icon name="phone" size={22} /></Orb>
      <div class="beam">
        {#if t.phase !== 'connecting'}<i class="p"></i><i class="p p2"></i><i class="p p3"></i>{/if}
      </div>
      <div class="target-tile glow">
        <Icon name={t.phase === 'relaying' ? 'lock' : 'laptop'} size={24} />
      </div>
    </div>
    <p class="beam-title">
      {t.phase === 'relaying'
        ? 'Locking and uploading'
        : t.phase === 'connecting'
          ? `Connecting to ${t.targetName}`
          : t.phase === 'reconnecting'
            ? 'Reconnecting…'
            : `Beaming to ${t.targetName}`}
    </p>
    <p class="muted beam-sub">
      {t.phase === 'relaying' ? 'End-to-end encrypted' : 'Peer to peer'}
      {#if speed > 0 && t.phase !== 'connecting'}· {formatBytes(speed)}/s{#if etaText}
          · {etaText}{/if}{/if}
    </p>
  </section>
{:else if t.phase === 'delivered' || t.phase === 'partial'}
  <section class="landed" aria-live="polite">
    <div class="burst-wrap">
      <span class="burst"></span>
      <div class="pop">
        <Orb size={110} tone="green">
          <svg
            width="48"
            height="48"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#fff"
            stroke-width="2.6"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path class="check" d="M5 12l5 5L20 7" />
          </svg>
        </Orb>
      </div>
    </div>
    <h2 class="headline">{t.phase === 'partial' ? t.detail : `Landed on ${t.targetName}`}</h2>
    <p class="muted lede">Everything arrived.</p>
  </section>
{:else if t.phase === 'relayed'}
  <section class="landed" aria-live="polite">
    <Orb size={96}><Icon name="lock" size={36} /></Orb>
    <h2 class="headline">Uploaded securely</h2>
    <p class="muted lede">{t.detail}</p>
  </section>
{:else if t.phase === 'queued'}
  <section class="card notice" aria-live="polite">
    <h2>Waiting for {t.targetName}</h2>
    <p class="muted">{t.detail} Keep DropLink open on this device.</p>
  </section>
{:else}
  <section class="card notice" aria-live="polite">
    <h2>{t.phase === 'cancelled' ? 'Cancelled' : 'Not sent'}</h2>
    <p class="muted">{t.phase === 'cancelled' ? 'Nothing more will be sent.' : t.detail}</p>
  </section>
{/if}

<style>
  .stage {
    position: relative;
    text-align: center;
  }
  .stage > :not(.glow-spot):not(.sr-only) {
    position: relative;
    z-index: 1;
  }
  .dial {
    position: relative;
    height: 240px;
  }
  .ring {
    position: absolute;
    left: 50%;
    top: 50%;
    margin: -110px 0 0 -110px;
    transform: rotate(-90deg);
  }
  .ring circle:last-child {
    transition: stroke-dashoffset 0.25s linear;
  }
  .wave {
    position: absolute;
    left: 50%;
    top: 50%;
    width: 200px;
    height: 200px;
    border-radius: 50%;
    border: 1px solid rgba(232, 64, 15, 0.35);
    transform: translate(-50%, -50%) scale(0.6);
    opacity: 0;
    animation: s-wave 2.6s ease-out infinite both;
  }
  .w2 {
    animation-delay: 1.3s;
  }
  .face {
    position: absolute;
    left: 50%;
    top: 50%;
    width: 140px;
    height: 140px;
    margin: -70px 0 0 -70px;
    border-radius: 50%;
    background: var(--surface);
    border: 1px solid var(--border);
    box-shadow: 0 16px 40px rgba(17, 19, 24, 0.08);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    animation: s-breath 2.8s ease-in-out infinite;
  }
  .bell {
    display: inline-flex;
    transform-origin: 50% 10%;
    animation: s-bell 2.4s ease-in-out infinite;
  }
  .secs {
    font-family: var(--display);
    font-size: 28px;
    font-weight: 700;
    letter-spacing: -0.5px;
  }
  .headline {
    font-size: 1.45rem;
    margin: 0.75rem 0 0;
  }
  .lede {
    max-width: 19rem;
    margin: 0.5rem auto 0;
    font-size: 0.9rem;
  }
  .dots i {
    font-style: normal;
    animation: s-dots 1.2s ease-in-out infinite;
  }
  .dots i:nth-child(2) {
    animation-delay: 0.2s;
  }
  .dots i:nth-child(3) {
    animation-delay: 0.4s;
  }
  .steps {
    list-style: none;
    margin: 1.25rem 0 0;
    padding: 1.1rem;
    border-radius: 26px;
    display: flex;
    flex-direction: column;
    gap: 1rem;
    text-align: left;
  }
  .steps li {
    display: flex;
    gap: 0.75rem;
    align-items: flex-start;
    font-size: 0.9rem;
  }
  .steps small {
    color: var(--text-2);
    font-size: 0.78rem;
  }
  .dim {
    color: var(--text-3);
  }
  .step-dot {
    width: 26px;
    height: 26px;
    border-radius: 50%;
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--text-2);
  }
  .done-x {
    background: var(--track);
  }
  .active {
    background: var(--accent);
    box-shadow: 0 0 0 4px var(--accent-soft);
  }
  .pulse-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #fff;
    animation: s-dots 1.2s ease-in-out infinite;
  }
  .later {
    border: 1.5px dashed var(--border-strong);
  }

  .beam-card {
    padding: 1.5rem 1.25rem;
    border-radius: 28px;
    box-shadow: var(--shadow-lg);
    text-align: center;
  }
  .beam-row {
    display: flex;
    align-items: center;
    gap: 0.9rem;
  }
  .beam {
    position: relative;
    flex: 1;
    height: 2px;
    background: repeating-linear-gradient(90deg, var(--border-strong) 0 6px, transparent 6px 10px);
  }
  .p {
    position: absolute;
    top: 50%;
    width: 10px;
    height: 10px;
    margin: -5px 0 0 -5px;
    border-radius: 50%;
    background: var(--accent);
    box-shadow: 0 0 0 3px rgba(232, 64, 15, 0.18);
    animation: s-packet 1.4s linear infinite;
  }
  .p2 {
    animation-delay: 0.47s;
  }
  .p3 {
    animation-delay: 0.94s;
  }
  .target-tile {
    width: 56px;
    height: 56px;
    border-radius: 18px;
    background: var(--surface);
    border: 1.5px solid var(--accent);
    display: flex;
    align-items: center;
    justify-content: center;
    flex: none;
    color: var(--text);
  }
  .glow {
    animation: s-glow 1.4s ease-in-out infinite;
  }
  .beam-title {
    margin: 1.1rem 0 0;
    font-family: var(--display);
    font-size: 1.25rem;
    font-weight: 700;
    letter-spacing: -0.3px;
  }
  .beam-sub {
    margin: 0.25rem 0 0;
    font-size: 0.82rem;
  }

  .landed {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    padding: 0.5rem 0 0.25rem;
  }
  .burst-wrap {
    position: relative;
    width: 110px;
    height: 110px;
  }
  .burst {
    position: absolute;
    left: 50%;
    top: 50%;
    width: 140px;
    height: 140px;
    border-radius: 50%;
    border: 2px solid rgba(14, 138, 67, 0.5);
    animation: s-burst 1.2s ease-out both;
  }
  .pop {
    animation: s-pop 0.6s cubic-bezier(0.2, 0.8, 0.2, 1) both;
  }
  .check {
    stroke-dasharray: 40;
    stroke-dashoffset: 40;
    animation: s-draw 0.5s 0.3s ease-out forwards;
  }
  .notice h2 {
    margin: 0 0 0.35rem;
  }
  .notice p {
    margin: 0;
  }

  @keyframes s-wave {
    0% {
      transform: translate(-50%, -50%) scale(0.6);
      opacity: 0.8;
    }
    100% {
      transform: translate(-50%, -50%) scale(1.5);
      opacity: 0;
    }
  }
  @keyframes s-breath {
    0%,
    100% {
      transform: scale(1);
    }
    50% {
      transform: scale(1.04);
    }
  }
  @keyframes s-bell {
    0%,
    60%,
    100% {
      transform: rotate(0);
    }
    10% {
      transform: rotate(14deg);
    }
    20% {
      transform: rotate(-12deg);
    }
    30% {
      transform: rotate(8deg);
    }
    40% {
      transform: rotate(-6deg);
    }
  }
  @keyframes s-dots {
    0%,
    100% {
      opacity: 0.25;
    }
    50% {
      opacity: 1;
    }
  }
  @keyframes s-packet {
    0% {
      left: 0;
      opacity: 0;
    }
    15% {
      opacity: 1;
    }
    85% {
      opacity: 1;
    }
    100% {
      left: 100%;
      opacity: 0;
    }
  }
  @keyframes s-glow {
    0%,
    100% {
      box-shadow: 0 0 0 0 rgba(232, 64, 15, 0.25);
    }
    50% {
      box-shadow: 0 0 0 8px rgba(232, 64, 15, 0);
    }
  }
  @keyframes s-burst {
    0% {
      transform: translate(-50%, -50%) scale(0.3);
      opacity: 1;
    }
    100% {
      transform: translate(-50%, -50%) scale(2.2);
      opacity: 0;
    }
  }
  @keyframes s-pop {
    0% {
      transform: scale(0.4);
      opacity: 0;
    }
    60% {
      transform: scale(1.12);
      opacity: 1;
    }
    100% {
      transform: scale(1);
    }
  }
  @keyframes s-draw {
    to {
      stroke-dashoffset: 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .wave,
    .face,
    .bell,
    .dots i,
    .pulse-dot,
    .p,
    .glow {
      animation: none;
    }
    .wave,
    .p {
      opacity: 0;
    }
    .check {
      stroke-dashoffset: 0;
    }
  }
</style>
