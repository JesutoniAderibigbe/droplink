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
  import Beacon from '../components/Beacon.svelte';
  import Icon from '../components/Icon.svelte';

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

<main id="main" tabindex="-1" class="landing">
  <div class="glow-spot" style:top="40px" style:width="520px" style:height="520px"></div>

  <div class="inner">
    <header class="brand row spread">
      <span class="row">
        <span class="logo" aria-hidden="true"><Icon name="download" size={16} stroke={2.2} /></span>
        <span class="wordmark">DropLink</span>
      </span>
    </header>

    <div class="hero">
      <Beacon size={150} />
      <div class="copy rise">
        <h1>Your files,<br />beamed across.</h1>
        <p class="muted">
          Sign in on your phone and your computer. They find each other, like AirDrop, without the
          cables.
        </p>
      </div>
    </div>

    {#if revoked}
      <p class="card warn" role="status">
        This device was removed from your account, so it was signed out.
      </p>
    {/if}
    {#if sharedCount > 0}
      <p class="card soft" role="status">
        Sign in to send the {sharedCount === 1 ? 'item' : `${sharedCount} items`} you shared. They'll
        be waiting.
      </p>
    {/if}

    <section class="glass sheet rise d2" aria-labelledby="signin-title">
      <h2 id="signin-title" class="sheet-title">
        {mode === 'signin' ? 'Sign in' : 'Create your account'}
      </h2>

      {#if googleLogin}
        <button class="ink big" onclick={() => run(signInWithGoogle)} disabled={busy}
          >Continue with Google</button
        >
        <div class="or" aria-hidden="true"><span>or</span></div>
      {/if}

      <form class="stack" onsubmit={onSubmit}>
        <div class="field">
          <label class="sr-only" for="email">Email</label>
          <input
            id="email"
            type="email"
            autocomplete="email"
            required
            bind:value={email}
            placeholder="you@example.com"
          />
        </div>
        <div class="pw">
          <label class="sr-only" for="password">Password</label>
          <input
            id="password"
            type={showPassword ? 'text' : 'password'}
            autocomplete={mode === 'signup' ? 'new-password' : 'current-password'}
            minlength={MIN_PASSWORD_LENGTH}
            required
            placeholder={mode === 'signup'
              ? `Password (${MIN_PASSWORD_LENGTH}+ characters)`
              : 'Password'}
            bind:value={password}
          />
          <button
            type="button"
            class="show"
            aria-pressed={showPassword}
            onclick={() => (showPassword = !showPassword)}
          >
            {showPassword ? 'Hide' : 'Show'}
          </button>
        </div>
        <button
          type="submit"
          class="primary big go"
          disabled={busy ||
            !email ||
            password.length < (mode === 'signup' ? MIN_PASSWORD_LENGTH : 1)}
        >
          {mode === 'signin' ? 'Sign in' : 'Create account'}
          <Icon name="right" stroke={2} />
        </button>
      </form>

      {#if error}<p class="error" role="alert">{error}</p>{/if}

      <p class="switch">
        {mode === 'signin' ? 'New here?' : 'Already have an account?'}
        <button type="button" class="link" onclick={switchMode}>
          {mode === 'signin' ? 'Create an account' : 'Sign in'}
        </button>
      </p>
      <p class="fine muted">
        Use the same email and password on every device. Peer to peer by default.
        <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a>
      </p>
    </section>
  </div>
</main>

<style>
  .landing {
    position: relative;
    overflow: hidden;
    min-height: 100dvh;
  }
  .inner {
    position: relative;
    z-index: 1;
    max-width: 26rem;
    margin: 0 auto;
    padding: 1.5rem 1.25rem 2rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  .logo {
    width: 30px;
    height: 30px;
    border-radius: 10px;
    background: var(--ink);
    color: var(--ink-text);
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .wordmark {
    font-family: var(--display);
    font-weight: 700;
    font-size: 19px;
    letter-spacing: -0.3px;
  }
  .hero {
    text-align: center;
  }
  .copy {
    margin-top: -0.5rem;
  }
  h1 {
    font-size: 2.15rem;
    line-height: 1.08;
    letter-spacing: -1px;
    margin: 0;
  }
  .copy p {
    margin: 0.85rem auto 0;
    max-width: 19rem;
    font-size: 0.95rem;
  }
  .sheet {
    border-radius: 28px;
    padding: 1.1rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .sheet-title {
    font-size: 1.1rem;
    margin: 0.1rem 0 0;
  }
  .pw {
    position: relative;
  }
  .pw input {
    padding-right: 5rem;
  }
  .show {
    position: absolute;
    right: 6px;
    top: 50%;
    transform: translateY(-50%);
    min-height: 40px;
    border: none;
    background: transparent;
    color: var(--text-2);
    font-size: 0.85rem;
  }
  .show:active:not(:disabled) {
    transform: translateY(-50%);
  }
  .go {
    box-shadow: 0 8px 20px rgba(232, 64, 15, 0.3);
  }
  .or {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    color: var(--text-2);
    font-size: 0.85rem;
  }
  .or::before,
  .or::after {
    content: '';
    flex: 1;
    border-top: 1px solid var(--border);
  }
  .switch,
  .fine {
    margin: 0;
    text-align: center;
    font-size: 0.85rem;
  }
  .fine {
    font-size: 0.78rem;
  }
  .error {
    margin: 0;
    text-align: center;
  }
</style>
