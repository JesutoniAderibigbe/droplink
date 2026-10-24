// Wires the encrypted relay into the app:
// - sender: the engine's `relay` hook (used when the target didn't answer in ~20 s)
// - receiver: an inbox that downloads relayed transfers addressed to this
//   device whenever DropLink is open (on start, when it regains focus, and
//   every couple of minutes), then deletes the relay copy.

import { describeFiles } from '../core/format';
import { humanError } from '../core/errors';
import type { TransferRow } from '../core/types';
import {
  checkRelayEligible,
  deleteRelayObjects,
  downloadRelay,
  RelayIneligible,
  uploadRelay,
} from '../services/relay';
import { defaultSinkFactory } from '../services/sinks';
import type { IncomingFileView, IncomingView } from '../services/transferEngine';
import * as api from '../services/transfersApi';
import { deviceById, onSessionReady, session } from './session.svelte';
import { settings } from './settings.svelte';
import { getSignaling } from './presence.svelte';
import { configureEngine, recordReceivedFile, upsertIncoming } from './transfers.svelte';

const INBOX_INTERVAL_MS = 2 * 60_000;

configureEngine({
  async relay(t, files) {
    t.relayNote = '';
    if (!settings.relayEnabled) {
      t.relayNote = 'The encrypted relay is off in Settings.';
      return 'not-eligible';
    }
    try {
      await checkRelayEligible(t.queue.totalBytes, files);
    } catch (e) {
      if (!(e instanceof RelayIneligible)) throw e;
      t.relayNote =
        e.message === 'too_large'
          ? 'Too big for the encrypted relay (100 MB).'
          : e.message === 'quota_exceeded'
            ? "Today's relay allowance is used up."
            : 'Not eligible for the relay.';
      return 'not-eligible';
    }

    t.emit('relaying', 'Encrypting on this device and uploading…');
    try {
      await uploadRelay({
        userId: session.userId!,
        transferId: t.id,
        targetPublicJwk: t.target.public_key,
        files,
        signal: t.abort.signal,
        onProgress: (fileId, bytes) => {
          t.queue.progress(fileId, bytes);
          t.emit();
        },
      });
    } catch (e) {
      if (t.abort.signal.aborted) throw e;
      console.warn('[relay] upload failed', (e as Error)?.message);
      t.relayNote = humanError(e);
      return 'not-eligible';
    }
    for (const f of files) t.queue.complete(f.id);
    // If the receiver is open (just unreachable directly), it fetches right away.
    getSignaling()
      .send('relay-ready', { to: t.target.id, transferId: t.id })
      .catch(() => {});
    t.emit(
      'relayed',
      `Encrypted and uploaded. ${t.view().targetName} gets it the next time DropLink opens there (within 24 hours). You can close DropLink.`,
    );
    return 'relayed';
  },
});

// --- Receiver inbox ------------------------------------------------------------------

const inProgress = new Set<string>();

async function receiveRelayed(row: TransferRow, privateKey: CryptoKey): Promise<void> {
  const from = deviceById(row.from_device_id);
  const view: IncomingView = {
    id: row.id,
    fromId: row.from_device_id,
    fromName: from?.name ?? 'Another device',
    via: 'relay',
    phase: 'receiving',
    fileCount: row.file_count,
    totalBytes: row.total_bytes,
    files: [],
    createdAt: Date.now(),
  };
  const emit = () => upsertIncoming({ ...view, files: view.files.map((f) => ({ ...f })) });
  emit();
  try {
    await downloadRelay(row, privateKey, defaultSinkFactory(), {
      onManifest(m) {
        view.fileCount = m.files.length;
        view.totalBytes = m.files.reduce((s, f) => s + f.size, 0);
        view.files = m.files.map((f, i) => ({
          id: `${row.id}:${i}`,
          name: f.name,
          size: f.size,
          received: 0,
          status: 'receiving',
        }));
        emit();
      },
      onFileStart() {},
      onProgress(i, bytes) {
        view.files[i].received = bytes;
        emit();
      },
      onFileDone(i, saved) {
        Object.assign(view.files[i], { status: 'done', received: view.files[i].size, saved });
        emit();
        recordReceivedFile({ ...view }, { ...view.files[i] } as IncomingFileView);
      },
    });
    view.phase = 'done';
    emit();
    await api.setTransferStatus(row.id, 'delivered');
    await deleteRelayObjects(row.id);
  } catch (e) {
    const name = (e as Error)?.name;
    console.warn('[relay] receive failed', name);
    view.phase = 'failed';
    for (const f of view.files)
      if (f.status === 'receiving')
        Object.assign(f, { status: 'failed', error: 'Could not decrypt or save' });
    emit();
    // Decryption failure is permanent (wrong key / tampered): give up and clean up.
    // Anything else (network) is retried on the next inbox check.
    if (name === 'OperationError' || /Invalid manifest/.test(String((e as Error)?.message))) {
      await api.trySetStatus(row.id, 'failed');
      await deleteRelayObjects(row.id).catch(() => {});
    }
  } finally {
    inProgress.delete(row.id);
  }
}

export async function checkInbox(): Promise<void> {
  const device = session.device;
  const key = session.identity?.privateKey;
  if (!device || !key) return;
  let rows: TransferRow[];
  try {
    rows = await api.listRelayedFor(device.id);
  } catch {
    return;
  }
  for (const row of rows) {
    if (inProgress.has(row.id) || !row.relay_params) continue;
    inProgress.add(row.id);
    console.info(`[relay] receiving ${describeFiles(row.file_count, row.total_bytes)}`);
    await receiveRelayed(row, key); // one at a time keeps disk and memory use calm
  }
}

onSessionReady(() => {
  void checkInbox();
  const offReady = getSignaling().on('relay-ready', () => void checkInbox());
  const onVisible = () => document.visibilityState === 'visible' && void checkInbox();
  document.addEventListener('visibilitychange', onVisible);
  const timer = setInterval(() => void checkInbox(), INBOX_INTERVAL_MS);
  return () => {
    document.removeEventListener('visibilitychange', onVisible);
    clearInterval(timer);
    offReady();
  };
});
