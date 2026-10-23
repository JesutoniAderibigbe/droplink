<script lang="ts">
  import { session, otherDevices, deviceById } from '../lib/state/session.svelte';
  import { presence, isOnline } from '../lib/state/presence.svelte';
  import { transfers } from '../lib/state/transfers.svelte';
  import { listRecentTransfers } from '../lib/services/transfersApi';
  import type { TransferRow } from '../lib/core/types';
  import { describeFiles, timeAgo } from '../lib/core/format';
  import DeviceList from '../components/DeviceList.svelte';
  import DeviceIcon from '../components/DeviceIcon.svelte';
  import FolderCard from '../components/FolderCard.svelte';
  import InstallCard from '../components/InstallCard.svelte';
  import PushCard from '../components/PushCard.svelte';
  import OutgoingCard from '../components/OutgoingCard.svelte';

  // Online devices first, then most recently seen.
  const others = $derived(
    otherDevices().toSorted(
      (a, b) => Number(b.id in presence.online) - Number(a.id in presence.online),
    ),
  );
  const active = $derived(
    transfers.outgoing.filter((t) => !['delivered', 'relayed', 'cancelled'].includes(t.phase)),
  );

  let recent = $state<TransferRow[] | null>(null);
  // Refresh whenever a transfer changes phase.
  const phases = $derived(
    transfers.outgoing.map((t) => t.phase).join() + transfers.incoming.map((t) => t.phase).join(),
  );
  $effect(() => {
    void phases;
    listRecentTransfers(8)
      .then((r) => (recent = r))
      .catch(() => (recent = recent ?? []));
  });

  const statusText: Record<TransferRow['status'], string> = {
    pending: 'Waiting',
    p2p: 'In progress',
    relayed: 'Waiting in encrypted relay',
    delivered: 'Delivered',
    failed: 'Failed',
    cancelled: 'Cancelled',
    expired: 'Expired',
  };
</script>

<main id="main" tabindex="-1" class="container stack">
  <section class="card row this-device" aria-label="This device">
    <DeviceIcon kind={session.device!.kind} size={36} />
    <div class="grow">
      <small class="muted">This device</small>
      <h1 class="ellipsis">{session.device!.name}</h1>
    </div>
    <a class="button" href="/settings">Rename</a>
  </section>

  <a class="button primary big" href="/send">Send files</a>

  {#each active as t (t.id)}
    <OutgoingCard {t} />
  {/each}

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

  <PushCard />
  <FolderCard />
  <InstallCard />

  <section class="card" aria-labelledby="recent-title">
    <h2 id="recent-title">Recent transfers</h2>
    {#if recent === null}
      <p class="muted">Loading…</p>
    {:else if recent.length === 0}
      <p class="muted">No transfers yet. Pick some files and send them to another device.</p>
    {:else}
      <ul class="list">
        {#each recent as r (r.id)}
          {@const outgoing = r.from_device_id === session.device?.id}
          {@const other = deviceById(outgoing ? r.to_device_id : r.from_device_id)}
          <li class="row">
            <span aria-hidden="true" class="dir">{outgoing ? '↑' : '↓'}</span>
            <span class="grow">
              <span class="ellipsis block"
                >{outgoing ? 'To' : 'From'} {other?.name ?? 'a removed device'}</span
              >
              <small class="muted"
                >{describeFiles(r.file_count, r.total_bytes)} · {timeAgo(r.created_at)}</small
              >
            </span>
            <span
              class="badge {r.status === 'delivered'
                ? 'ok'
                : r.status === 'failed'
                  ? 'danger'
                  : ''}">{statusText[r.status]}</span
            >
          </li>
        {/each}
      </ul>
    {/if}
  </section>
</main>

<style>
  .this-device h1 {
    margin: 0;
  }
  .block {
    display: block;
  }
  .dir {
    width: 1.5rem;
    text-align: center;
    color: var(--text-2);
    font-weight: 700;
  }
</style>
