<script lang="ts">
  import { sendMagicLink, signInWithGoogle, verifyEmailCode } from '../lib/state/auth.svelte';
  import { humanError } from '../lib/core/errors';
  import { listEntries } from '../lib/services/outbox';
  import { consumeRevokedNotice } from '../lib/state/session.svelte';

  const revoked = consumeRevokedNotice();
  let sharedCount = $state(0);
  void listEntries('shared').then((e) => (sharedCount = e.reduce((n, x) => n + x.files.length, 0)));

  let email = $state('');
  let code = $state('');
  let sent = $state(false);
  let busy = $state(false);
  let error = $state('');

  async function run(fn: () => Promise<void>) {
    error = '';
    busy = true;
    try {
      await fn();
    } catch (e) {
      console.warn('[auth]', (e as Error)?.message);
      error = humanError(e);
    } finally {
      busy = false;
    }
  }

  function onSubmitEmail(event: SubmitEvent) {
    event.preventDefault();
    run(async () => {
      await sendMagicLink(email.trim());
      sent = true;
    });
  }

  function onSubmitCode(event: SubmitEvent) {
    event.preventDefault();
    run(() => verifyEmailCode(email.trim(), code.replace(/\s/g, '')));
  }
</script>

<main id="main" tabindex="-1" class="container stack landing">
  <header class="hero">
    <img src="/icons/icon.svg" alt="" width="72" height="72" />
    <h1>DropLink</h1>
    <p class="lead">Send files between your own phone and computer, like AirDrop.</p>
  </header>

  <ul class="points">
    <li><strong>Direct.</strong> Files go device to device. They never touch our server.</li>
    <li><strong>No pairing.</strong> Sign in on each device and they find each other.</li>
    <li>
      <strong>Works when you're away.</strong> If the other device is closed, it gets a notification,
      or an end-to-end encrypted copy waits for it for up to 24 hours.
    </li>
  </ul>

  {#if revoked}
    <p class="card warn" role="status">
      This device was removed from your account, so it was signed out.
    </p>
  {/if}
  {#if sharedCount > 0}
    <p class="card soft" role="status">
      Sign in to send the {sharedCount === 1 ? 'item' : `${sharedCount} items`} you shared. They'll be
      waiting.
    </p>
  {/if}

  <section class="card stack" aria-labelledby="signin-title">
    <h2 id="signin-title">Sign in</h2>
    <button class="primary big" onclick={() => run(signInWithGoogle)} disabled={busy}>
      Continue with Google
    </button>

    <div class="or" aria-hidden="true"><span>or</span></div>

    {#if !sent}
      <form class="stack" onsubmit={onSubmitEmail}>
        <div class="field">
          <label for="email">Email</label>
          <input
            id="email"
            type="email"
            autocomplete="email"
            required
            bind:value={email}
            placeholder="you@example.com"
          />
        </div>
        <button type="submit" disabled={busy || !email}>Email me a sign-in link</button>
      </form>
    {:else}
      <form class="stack" onsubmit={onSubmitCode}>
        <p>
          We sent a sign-in link to <strong>{email}</strong>. Open it on this device. If the
          email also shows a 6-digit code, you can type it here instead.
        </p>
        <div class="field">
          <label for="code">Code</label>
          <input
            id="code"
            inputmode="numeric"
            autocomplete="one-time-code"
            pattern="[0-9 ]*"
            required
            bind:value={code}
          />
        </div>
        <button type="submit" class="primary" disabled={busy || code.length < 6}>Sign in</button>
        <button type="button" class="link" onclick={() => ((sent = false), (code = ''))}
          >Use a different email</button
        >
      </form>
    {/if}

    {#if error}<p class="error" role="alert">{error}</p>{/if}
  </section>

  <footer class="row wrap muted">
    <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a>
  </footer>
</main>

<style>
  .landing {
    max-width: 30rem;
    padding-top: 2.5rem;
  }
  .hero {
    text-align: center;
  }
  .hero img {
    border-radius: 18px;
  }
  .lead {
    font-size: 1.1rem;
    color: var(--text-2);
  }
  .points {
    margin: 0;
    padding-left: 1.2rem;
    display: grid;
    gap: 0.4rem;
  }
  .or {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    color: var(--text-2);
    font-size: 0.9rem;
  }
  .or::before,
  .or::after {
    content: '';
    flex: 1;
    border-top: 1px solid var(--border);
  }
  footer {
    justify-content: center;
  }
</style>
