<script lang="ts">
  import { LIMITS } from '../lib/config';
  const relayMb = LIMITS.relayBytesPerTransfer / 1024 / 1024;
</script>

<main class="container stack prose">
  <p><a href="/">← DropLink</a></p>
  <h1>Privacy</h1>
  <p class="muted">Plain-language summary. Last updated October 2026.</p>

  <h2>Files go directly between your devices</h2>
  <p>
    When both devices have DropLink open, files travel over an encrypted peer-to-peer WebRTC
    connection. The file contents never pass through or get stored on our servers. If your networks
    can't connect directly, the connection goes through a TURN relay (Cloudflare), which only
    forwards encrypted WebRTC traffic it can't read.
  </p>

  <h2>The relay is end-to-end encrypted and deleted automatically</h2>
  <p>
    If the other device doesn't answer within about 20 seconds, transfers up to {relayMb} MB are encrypted
    on your device with a key only the receiving device can derive, then uploaded to temporary storage.
    That includes the file names. We can't read them. The copy is deleted as soon as it's received, and
    after 24 hours no matter what.
  </p>

  <h2>What we store</h2>
  <ul>
    <li>Your account: email address, and your name if you sign in with Google.</li>
    <li>
      Your devices: the name you give each one, its type (phone, Mac…), its public key, and when it
      was last seen.
    </li>
    <li>Push notification addresses for devices where you allowed notifications.</li>
    <li>
      Transfer records: which device sent to which, how many files, the total size, the status, and
      timestamps. Not file names or contents.
    </li>
    <li>Daily usage counters, so we can enforce fair-use limits.</li>
  </ul>
  <p>
    Some things stay only on your device: the device's private key, your chosen download folder,
    your list of received file names, and files waiting to send.
  </p>

  <h2>Who we share data with</h2>
  <p>
    Our infrastructure providers only: Supabase (database, sign-in, storage), Netlify (hosting the
    app), Cloudflare (TURN relay), and your browser's push service (Google, Apple or Mozilla) for
    notifications, which carry only the sending device's name, file count and size. We don't sell
    data or show ads, and there are no trackers.
  </p>

  <h2>Deleting your data</h2>
  <p>
    Settings → <strong>Delete account</strong> permanently deletes your account, devices, transfer records,
    push addresses and any relay copies right away. Removing a single device in Settings deletes its push
    addresses and stops it from receiving.
  </p>
</main>

<style>
  .prose {
    max-width: 40rem;
  }
  .prose h2 {
    margin-top: 0.5rem;
  }
  .prose ul {
    margin: 0;
    padding-left: 1.2rem;
  }
</style>
