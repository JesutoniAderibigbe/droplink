<script lang="ts">
  import {
    MIN_PASSWORD_LENGTH,
    signInWithGoogle,
    signInWithPassword,
    signUpWithPassword,
  } from '../lib/state/auth.svelte';
  import { humanError } from '../lib/core/errors';
  import { listEntries } from '../lib/services/outbox';
  import { consumeRevokedNotice } from '../lib/state/session.svelte';

  // Google appears once it's configured in Supabase (VITE_ENABLE_GOOGLE_LOGIN=true).
  const googleLogin = import.meta.env.VITE_ENABLE_GOOGLE_LOGIN === 'true';

  const revoked = consumeRevokedNotice();
  let sharedCount = $state(0);
  void listEntries('shared').then((e) => (sharedCount = e.reduce((n, x) => n + x.files.length, 0)));

  let mode = $state<'signin' | 'signup'>('signin');
  let email = $state('');
  let password = $state('');
  let showPassword = $state(false);
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

  function onSubmit(event: SubmitEvent) {
    event.preventDefault();
    const addr = email.trim();
    run(() =>
      mode === 'signup' ? signUpWithPassword(addr, password) : signInWithPassword(addr, password),
    );
  }

  function switchMode() {
    mode = mode === 'signin' ? 'signup' : 'signin';
    error = '';
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
    <h2 id="signin-title">{mode === 'signin' ? 'Sign in' : 'Create your account'}</h2>

    {#if googleLogin}
      <button class="primary big" onclick={() => run(signInWithGoogle)} disabled={busy}
        >Continue with Google</button
      >
      <div class="or" aria-hidden="true"><span>or</span></div>
    {/if}

    <form class="stack" onsubmit={onSubmit}>
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
      <div class="field">
        <label for="password">Password</label>
        <div class="row">
          <input
            id="password"
            type={showPassword ? 'text' : 'password'}
            autocomplete={mode === 'signup' ? 'new-password' : 'current-password'}
            minlength={MIN_PASSWORD_LENGTH}
            required
            bind:value={password}
          />
          <button
            type="button"
            class="icon"
            aria-pressed={showPassword}
            onclick={() => (showPassword = !showPassword)}
          >
            {showPassword ? 'Hide' : 'Show'}
          </button>
        </div>
        {#if mode === 'signup'}<small class="muted"
            >At least {MIN_PASSWORD_LENGTH} characters.</small
          >{/if}
      </div>
      <button
        type="submit"
        class={googleLogin ? '' : 'primary big'}
        disabled={busy || !email || password.length < (mode === 'signup' ? MIN_PASSWORD_LENGTH : 1)}
      >
        {mode === 'signin' ? 'Sign in' : 'Create account'}
      </button>
    </form>

    <p class="switch">
      {mode === 'signin' ? 'New here?' : 'Already have an account?'}
      <button type="button" class="link" onclick={switchMode}>
        {mode === 'signin' ? 'Create an account' : 'Sign in'}
      </button>
    </p>
    <p class="muted hint">Use the same email and password on your phone and your computer.</p>

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
  .switch,
  .hint {
    margin: 0;
    text-align: center;
  }
  .hint {
    font-size: 0.9rem;
  }
  footer {
    justify-content: center;
  }
</style>
