<script lang="ts">
  import { session, otherDevices } from '../lib/state/session.svelte';
  import { presence, isOnline } from '../lib/state/presence.svelte';
  import DeviceList from '../components/DeviceList.svelte';
  import DeviceIcon from '../components/DeviceIcon.svelte';

  // Online devices first, then most recently seen.
  const others = $derived(
    otherDevices().toSorted(
      (a, b) => Number(b.id in presence.online) - Number(a.id in presence.online),
    ),
  );
</script>

<main class="container stack">
  <section class="card row this-device" aria-label="This device">
    <DeviceIcon kind={session.device!.kind} size={36} />
    <div class="grow">
      <small class="muted">This device</small>
      <h1 class="ellipsis">{session.device!.name}</h1>
    </div>
    <a class="button" href="/settings">Rename</a>
  </section>

  <section class="card" aria-labelledby="devices-title">
    <div class="row spread">
      <h2 id="devices-title">My devices</h2>
      {#if presence.status !== 'connected'}
        <span class="badge warn" role="status"
          >{presence.status === 'connecting' ? 'Connecting…' : 'Offline, retrying…'}</span
        >
      {/if}
    </div>
    <DeviceList
      devices={others}
      {isOnline}
      emptyText="Sign in to DropLink with the same account on your other phone or computer and it will appear here."
    />
  </section>
</main>

<style>
  .this-device h1 {
    margin: 0;
  }
</style>
