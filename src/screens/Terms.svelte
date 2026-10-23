<script lang="ts">
  import { LIMITS } from '../lib/config';
  const mb = (n: number) => Math.round(n / 1024 / 1024);
</script>

<main id="main" tabindex="-1" class="container stack prose">
  <p><a href="/">← DropLink</a></p>
  <h1>Terms</h1>
  <p class="muted">Short version. Last updated October 2026.</p>

  <h2>What DropLink is for</h2>
  <p>
    DropLink moves files between devices signed in to <em>your own</em> account. It isn't for sending
    files to other people and isn't a backup or storage service.
  </p>

  <h2>Fair use</h2>
  <ul>
    <li>Direct (peer-to-peer) transfers have no size limit beyond what your devices can handle.</li>
    <li>
      The encrypted relay is limited to {mb(LIMITS.relayBytesPerTransfer)} MB per transfer, {mb(
        LIMITS.relayBytesPerDay,
      )}
      MB per day and {LIMITS.relayTransfersPerHour} relayed transfers per hour. Relay copies expire after
      24 hours.
    </li>
    <li>
      Don't use DropLink to break the law, to share content you don't have the right to share, or to
      attack the service.
    </li>
  </ul>

  <h2>Your files are yours</h2>
  <p>
    We don't claim any rights to what you send. Because relay copies are end-to-end encrypted, we
    can't see them.
  </p>

  <h2>No warranty</h2>
  <p>
    DropLink is provided as-is. Keep your own copies of anything important; a transfer can fail. We
    may suspend accounts that abuse the service, and we may change these terms. If we do, we'll
    update this page.
  </p>

  <h2>Leaving</h2>
  <p>You can delete your account at any time in Settings. That removes your data right away.</p>
</main>

<style>
  .prose {
    max-width: 40rem;
  }
  .prose ul {
    margin: 0;
    padding-left: 1.2rem;
  }
</style>
