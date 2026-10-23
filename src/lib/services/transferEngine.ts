// The AirDrop logic. One engine per signed-in device.
//
// Sending (OutgoingTransfer.run):
//   1. Create a `transfers` row (pending).
//   2. Reach the target: if it's in Presence, send transfer-request over
//      Broadcast and wait for transfer-accept (it's the same user's device, so
//      it auto-accepts). If it isn't, ask the server to Web Push it
//      (`notifyOffline`) and wait up to ~20 s for it to appear and accept.
//   3. Accepted: WebRTC (we're the offerer), send files one at a time.
//      Connection drops are retried with exponential backoff, resuming from the
//      receiver's last acknowledged chunk.
//   4. Not reachable: encrypt and upload to the relay if it fits the limits
//      (`relay` hook), otherwise park in the outbox (phase "queued") and send
//      automatically when the target next shows up in Presence.
//
// Receiving (IncomingTransfer): accept requests from our own devices, answer
// offers, and feed data channels into a ReceiverSession, which survives
// reconnects.
//
// Everything here is plain TypeScript; state/transfers.svelte.ts turns the
// views it emits into reactive UI state.

import { TRANSFER } from '../config';
import { backoffDelay, FileQueue, type QueueItem } from '../core/fileQueue';
import type { FileMeta } from '../core/protocol';
import type { OfferSignal, IceSignal, TransferRequestSignal } from '../core/signal';
import type { SavedFile, SendFile, SinkFactory } from '../core/sink';
import type { DeviceRow } from '../core/types';
import { getIceServers } from './ice';
import { sendOverChannel, TransferCancelled } from './p2pSender';
import { ReceiverSession } from './p2pReceiver';
import { PeerSession } from './peer';
import type { Signaling } from './signaling';
import * as api from './transfersApi';

// ---------------------------------------------------------------------------
// Views for the UI
// ---------------------------------------------------------------------------

export type OutgoingPhase =
  | 'preparing'
  | 'waiting' // waiting for the target to come online / accept (countdown)
  | 'connecting'
  | 'sending'
  | 'reconnecting'
  | 'relaying' // encrypting + uploading to the relay
  | 'queued' // parked until the target shows up
  | 'delivered'
  | 'relayed' // safely in the relay; the target will fetch it
  | 'partial'
  | 'failed'
  | 'cancelled';

export interface OutgoingView {
  id: string;
  targetId: string;
  targetName: string;
  phase: OutgoingPhase;
  detail: string;
  files: QueueItem[];
  totalBytes: number;
  transferredBytes: number;
  /** For the "Waiting for MacBook Air… 14 s" countdown. */
  waitUntil: number | null;
  createdAt: number;
}

export type IncomingPhase =
  'connecting' | 'receiving' | 'reconnecting' | 'done' | 'failed' | 'cancelled';

export interface IncomingFileView {
  id: string;
  name: string;
  size: number;
  received: number;
  status: 'receiving' | 'done' | 'cancelled' | 'failed';
  saved?: SavedFile;
  checksumOk?: boolean;
  error?: string;
}

export interface IncomingView {
  id: string;
  fromId: string;
  fromName: string;
  via: 'p2p' | 'relay';
  phase: IncomingPhase;
  fileCount: number;
  totalBytes: number;
  files: IncomingFileView[];
  createdAt: number;
}

export type RelayOutcome = 'relayed' | 'not-eligible';

export interface EngineDeps {
  signaling: Signaling;
  userId: string;
  self: () => DeviceRow;
  device: (id: string) => DeviceRow | undefined;
  /** Reload the device list; used when a request comes from a device we don't know yet. */
  refreshDevices: () => Promise<void>;
  isOnline: (id: string) => boolean;
  onDeviceJoined: (fn: (id: string) => void) => () => void;
  sinkFactory: SinkFactory;
  checksum: boolean;
  /** Web Push the target (milestone 8). */
  notifyOffline?: (t: {
    transferId: string;
    targetId: string;
    fileCount: number;
    totalBytes: number;
  }) => Promise<void>;
  /** Encrypt + upload to the relay (milestone 9). */
  relay?: (t: OutgoingTransfer, files: SendFile[]) => Promise<RelayOutcome>;
  onOutgoing: (v: OutgoingView) => void;
  onIncoming: (v: IncomingView) => void;
  onFileReceived: (t: IncomingView, f: IncomingFileView) => void;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(new TransferCancelled());
      },
      { once: true },
    );
  });

/** How often to re-send transfer-request while waiting (Broadcast is fire-and-forget). */
const REQUEST_RETRY_MS = 3_000;
/** How long the receiver keeps a half-received file waiting for the sender to reconnect. */
const RECEIVER_RESUME_WINDOW_MS = 90_000;

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

export class OutgoingTransfer {
  id = '';
  readonly queue: FileQueue;
  readonly files: Map<string, SendFile>;
  readonly abort = new AbortController();
  phase: OutgoingPhase = 'preparing';
  detail = '';
  /** Why the relay wasn't used (shown while queued). */
  relayNote = '';
  waitUntil: number | null = null;
  readonly createdAt = Date.now();

  private accepted: { resolve: () => void; reject: (e: Error) => void } | null = null;
  private peer: PeerSession | null = null;
  private attempt = 0;
  private notified = false;
  private wake: (() => void) | null = null;

  constructor(
    private readonly engine: TransferEngine,
    readonly target: DeviceRow,
    files: SendFile[],
  ) {
    this.files = new Map(files.map((f) => [f.id, f]));
    this.queue = new FileQueue(files);
  }

  get deps(): EngineDeps {
    return this.engine.deps;
  }

  view(): OutgoingView {
    return {
      id: this.id,
      targetId: this.target.id,
      targetName: this.deps.device(this.target.id)?.name ?? this.target.name,
      phase: this.phase,
      detail: this.detail,
      files: this.queue.snapshot(),
      totalBytes: this.queue.totalBytes,
      transferredBytes: this.queue.transferredBytes,
      waitUntil: this.waitUntil,
      createdAt: this.createdAt,
    };
  }

  emit(phase?: OutgoingPhase, detail?: string): void {
    if (phase) this.phase = phase;
    if (detail !== undefined) this.detail = detail;
    if (this.id) this.deps.onOutgoing(this.view());
  }

  cancel(): void {
    this.abort.abort();
  }

  /** "Relay now": stop waiting for the target and go straight to the fallback. */
  relayNow(): void {
    if (this.phase !== 'waiting' || this.waitUntil === null) return;
    this.waitUntil = Date.now();
    this.wake?.();
  }

  cancelFile(fileId: string): void {
    this.queue.cancel(fileId);
    if (this.queue.finished && !this.peer) this.abort.abort();
    this.emit();
  }

  async run(): Promise<void> {
    const signal = this.abort.signal;
    try {
      const row = await api.createTransfer({
        userId: this.deps.userId,
        from: this.deps.self().id,
        to: this.target.id,
        fileCount: this.files.size,
        totalBytes: this.queue.totalBytes,
      });
      this.id = row.id;
      this.engine.registerOutgoing(this);
      this.emit('preparing');

      for (;;) {
        if (await this.reachTarget(TRANSFER.waitForTargetMs)) {
          const outcome = await this.sendP2P();
          if (outcome !== 'unreachable') return;
        }
        // Couldn't reach it directly. Relay if allowed, otherwise wait for it.
        if (this.deps.relay) {
          const remaining = this.queue.remaining.map((i) => this.files.get(i.id)!);
          if ((await this.deps.relay(this, remaining)) === 'relayed') return;
        }
        this.waitUntil = null;
        this.emit(
          'queued',
          `${this.relayNote ? `${this.relayNote} ` : ''}Will send when ${this.view().targetName} is online.`,
        );
        await this.waitForJoin(signal);
      }
    } catch (e) {
      if (e instanceof TransferCancelled || signal.aborted) {
        this.queue.cancelAll();
        this.waitUntil = null;
        this.emit('cancelled', 'Cancelled');
        if (this.id) api.trySetStatus(this.id, 'cancelled');
      } else {
        console.error('[send] failed', e);
        this.waitUntil = null;
        for (const i of this.queue.remaining) this.queue.fail(i.id, 'Not sent');
        this.emit('failed', e instanceof Error ? e.message : 'Failed');
        if (this.id) api.trySetStatus(this.id, 'failed');
      }
    } finally {
      this.peer?.close();
      this.peer = null;
      this.engine.unregisterOutgoing(this);
    }
  }

  // ---- step 2: reach the target --------------------------------------------

  /** true = the target accepted; false = it didn't within `timeoutMs`. */
  private async reachTarget(timeoutMs: number): Promise<boolean> {
    const signal = this.abort.signal;
    const name = this.view().targetName;
    this.waitUntil = Date.now() + timeoutMs;
    this.emit('waiting', `Waiting for ${name}…`);

    if (!this.deps.isOnline(this.target.id) && !this.notified && this.deps.notifyOffline) {
      this.notified = true;
      this.deps
        .notifyOffline({
          transferId: this.id,
          targetId: this.target.id,
          fileCount: this.files.size,
          totalBytes: this.queue.totalBytes,
        })
        .catch((e) => console.warn('[send] push failed', e?.message));
    }

    const accepted = new Promise<void>((resolve, reject) => (this.accepted = { resolve, reject }));
    const aborted = abortPromise(signal);
    const unsubscribe = this.deps.onDeviceJoined((id) => {
      if (id === this.target.id) this.wake?.();
    });
    try {
      while (Date.now() < this.waitUntil) {
        if (this.deps.isOnline(this.target.id)) void this.sendRequest();
        const tick = new Promise<void>((r) => {
          this.wake = r;
          setTimeout(r, Math.min(REQUEST_RETRY_MS, Math.max(0, this.waitUntil! - Date.now())));
        });
        const winner = await Promise.race([
          accepted.then(() => 'accepted' as const),
          tick.then(() => 'tick' as const),
          aborted,
        ]);
        if (winner === 'accepted') return true;
      }
      return false;
    } finally {
      unsubscribe();
      this.accepted = null;
      this.wake = null;
      this.waitUntil = null;
    }
  }

  private async sendRequest(): Promise<void> {
    try {
      await this.deps.signaling.send('transfer-request', {
        to: this.target.id,
        transferId: this.id,
        fromName: this.deps.self().name,
        fileCount: this.files.size,
        totalBytes: this.queue.totalBytes,
      });
    } catch (e) {
      console.warn('[send] request failed', (e as Error).message);
    }
  }

  /** Called by the engine when the target answers our request. */
  handleAccept(): void {
    this.accepted?.resolve();
  }

  handleDecline(reason: string): void {
    this.accepted?.reject(
      new Error(reason === 'busy' ? 'The other device is busy' : 'Declined by the other device'),
    );
  }

  private waitForJoin(signal: AbortSignal): Promise<void> {
    if (this.deps.isOnline(this.target.id)) return sleep(REQUEST_RETRY_MS, signal);
    return new Promise<void>((resolve, reject) => {
      const off = this.deps.onDeviceJoined((id) => {
        if (id === this.target.id) {
          off();
          resolve();
        }
      });
      signal.addEventListener(
        'abort',
        () => {
          off();
          reject(new TransferCancelled());
        },
        { once: true },
      );
    });
  }

  // ---- step 3: P2P ----------------------------------------------------------

  /** 'done' = finished (delivered/partial); 'unreachable' = give up on P2P for now. */
  private async sendP2P(): Promise<'done' | 'unreachable'> {
    const signal = this.abort.signal;
    let markedP2P = false;
    for (let failures = 0; ;) {
      this.emit(this.queue.transferredBytes > 0 ? 'reconnecting' : 'connecting', 'Connecting…');
      const peer = new PeerSession({
        signaling: this.deps.signaling,
        transferId: this.id,
        peerId: this.target.id,
        attempt: this.attempt++,
        role: 'offerer',
        iceServers: await getIceServers(),
      });
      this.peer?.close();
      this.peer = peer;
      try {
        await peer.start();
        const channel = await Promise.race([peer.channel, abortPromise(signal)]);
        if (!markedP2P) {
          markedP2P = true;
          api.trySetStatus(this.id, 'p2p');
        }
        failures = 0;
        this.emit('sending', '');
        await sendOverChannel({
          channel,
          queue: this.queue,
          files: this.files,
          signal,
          checksum: this.deps.checksum,
          onUpdate: () => this.emit(),
        });
        this.finishP2P();
        return 'done';
      } catch (e) {
        if (e instanceof TransferCancelled || signal.aborted) throw new TransferCancelled();
        console.warn('[send] connection attempt failed', (e as Error).message);
        failures++;
        if (failures > TRANSFER.reconnectAttempts) {
          if (markedP2P) api.trySetStatus(this.id, 'pending');
          return 'unreachable';
        }
        this.emit('reconnecting', 'Connection dropped. Reconnecting…');
        await sleep(backoffDelay(failures - 1, TRANSFER.reconnectBaseDelayMs), signal);
        // If the target went away, give it a little while to come back.
        if (
          !this.deps.isOnline(this.target.id) &&
          !(await this.reachTarget(TRANSFER.waitForTargetMs))
        ) {
          if (markedP2P) api.trySetStatus(this.id, 'pending');
          return 'unreachable';
        }
      } finally {
        peer.close();
        if (this.peer === peer) this.peer = null;
      }
    }
  }

  private finishP2P(): void {
    const items = this.queue.items;
    const done = items.filter((i) => i.status === 'done').length;
    const cancelled = items.filter((i) => i.status === 'cancelled').length;
    if (done === items.length) {
      this.emit('delivered', 'Delivered');
      api.trySetStatus(this.id, 'delivered');
    } else if (done > 0) {
      this.emit('partial', `${done} of ${items.length} delivered`);
      api.trySetStatus(this.id, 'delivered');
    } else if (cancelled === items.length) {
      this.emit('cancelled', 'Cancelled');
      api.trySetStatus(this.id, 'cancelled');
    } else {
      this.emit('failed', items.find((i) => i.error)?.error ?? 'Not delivered');
      api.trySetStatus(this.id, 'failed');
    }
  }

  // ---- signaling from the target -------------------------------------------

  handleAnswer(msg: OfferSignal): void {
    if (this.peer && msg.attempt === this.peer.attempt) void this.peer.acceptAnswer(msg.sdp);
  }

  handleIce(msg: IceSignal): void {
    if (this.peer && msg.attempt === this.peer.attempt) void this.peer.addIce(msg.candidate);
  }
}

function abortPromise(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) reject(new TransferCancelled());
    signal.addEventListener('abort', () => reject(new TransferCancelled()), { once: true });
  });
}

// ---------------------------------------------------------------------------
// Receiving
// ---------------------------------------------------------------------------

class IncomingTransfer {
  readonly view: IncomingView;
  readonly session: ReceiverSession;
  private peer: PeerSession | null = null;
  private attempt = -1;
  private expiry: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly engine: TransferEngine,
    id: string,
    from: DeviceRow,
    fileCount: number,
    totalBytes: number,
  ) {
    this.view = {
      id,
      fromId: from.id,
      fromName: from.name,
      via: 'p2p',
      phase: 'connecting',
      fileCount,
      totalBytes,
      files: [],
      createdAt: Date.now(),
    };
    const deps = engine.deps;
    this.session = new ReceiverSession(
      deps.sinkFactory,
      {
        onFileStart: (meta: FileMeta) => {
          this.view.files = this.view.files.filter((f) => f.id !== meta.id);
          this.view.files.push({
            id: meta.id,
            name: meta.name,
            size: meta.size,
            received: 0,
            status: 'receiving',
          });
          this.view.fileCount = meta.total;
          this.emit('receiving');
        },
        onProgress: (id, bytes) => {
          const f = this.file(id);
          if (f) f.received = bytes;
          this.emit();
        },
        onFileDone: ({ id, saved, checksumOk }) => {
          const f = this.file(id);
          if (!f) return;
          Object.assign(f, { status: 'done', received: f.size, saved, checksumOk });
          this.emit();
          deps.onFileReceived(this.snapshot(), { ...f });
        },
        onFileCancelled: (id) => {
          const f = this.file(id);
          if (f && f.status === 'receiving') f.status = 'cancelled';
          this.emit();
        },
        onFileError: (id, message) => {
          const f = this.file(id);
          if (f) Object.assign(f, { status: 'failed', error: message });
          this.emit();
        },
        onFinished: (cancelled) => {
          const allDone =
            this.view.files.length > 0 && this.view.files.every((f) => f.status === 'done');
          this.emit(
            cancelled && !allDone
              ? 'cancelled'
              : this.view.files.some((f) => f.status === 'done')
                ? 'done'
                : 'failed',
          );
          this.close();
        },
      },
      deps.checksum,
    );
  }

  private file(id: string): IncomingFileView | undefined {
    return this.view.files.find((f) => f.id === id);
  }

  snapshot(): IncomingView {
    return { ...this.view, files: this.view.files.map((f) => ({ ...f })) };
  }

  emit(phase?: IncomingPhase): void {
    if (phase) this.view.phase = phase;
    this.engine.deps.onIncoming(this.snapshot());
  }

  async handleOffer(msg: OfferSignal): Promise<void> {
    if (msg.attempt <= this.attempt || this.session.isFinished) return;
    this.attempt = msg.attempt;
    clearTimeout(this.expiry);
    this.peer?.close();
    const peer = new PeerSession({
      signaling: this.engine.deps.signaling,
      transferId: this.view.id,
      peerId: this.view.fromId,
      attempt: msg.attempt,
      role: 'answerer',
      iceServers: await getIceServers(),
    });
    this.peer = peer;
    peer.onFail(() => {
      if (this.session.isFinished || this.peer !== peer) return;
      this.emit('reconnecting');
      this.armExpiry();
    });
    try {
      await peer.acceptOffer(msg.sdp);
      const channel = await peer.channel;
      if (this.peer !== peer) return;
      this.session.attach(channel, msg.attempt);
      if (this.view.phase === 'reconnecting') this.emit('receiving');
    } catch (e) {
      console.warn('[receive] connection attempt failed', (e as Error).message);
      if (this.peer === peer) this.armExpiry();
    }
  }

  handleIce(msg: IceSignal): void {
    if (this.peer && msg.attempt === this.peer.attempt) void this.peer.addIce(msg.candidate);
  }

  cancelFile(id: string): void {
    this.session.cancelFile(id);
  }

  devDrop(): void {
    this.peer?.simulateFailure();
  }

  /** If the sender doesn't reconnect in time, drop the partial file. */
  private armExpiry(): void {
    clearTimeout(this.expiry);
    this.expiry = setTimeout(() => {
      for (const f of this.view.files)
        if (f.status === 'receiving')
          Object.assign(f, { status: 'failed', error: 'Connection lost' });
      this.emit(this.view.files.some((f) => f.status === 'done') ? 'done' : 'failed');
      void this.session.dispose();
      this.close();
    }, RECEIVER_RESUME_WINDOW_MS);
  }

  close(): void {
    clearTimeout(this.expiry);
    this.peer?.close();
    this.peer = null;
    this.engine.unregisterIncoming(this.view.id);
  }
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export class TransferEngine {
  private outgoing = new Map<string, OutgoingTransfer>();
  private incoming = new Map<string, IncomingTransfer>();
  private finishedIncoming = new Set<string>();
  private offs: (() => void)[] = [];

  constructor(readonly deps: EngineDeps) {
    const s = deps.signaling;
    this.offs.push(
      s.on('transfer-request', (m) => void this.onRequest(m)),
      s.on(
        'transfer-accept',
        (m) =>
          this.outgoing.get(m.transferId)?.target.id === m.from &&
          this.outgoing.get(m.transferId)!.handleAccept(),
      ),
      s.on('transfer-decline', (m) => this.outgoing.get(m.transferId)?.handleDecline(m.reason)),
      s.on('answer', (m) => this.outgoing.get(m.transferId)?.handleAnswer(m)),
      s.on('offer', (m) => void this.onOffer(m)),
      s.on('ice', (m) => {
        this.outgoing.get(m.transferId)?.handleIce(m);
        this.incoming.get(m.transferId)?.handleIce(m);
      }),
    );
  }

  /** Start sending `files` to `target`. Returns immediately; progress arrives via onOutgoing. */
  send(target: DeviceRow, files: SendFile[]): OutgoingTransfer {
    const t = new OutgoingTransfer(this, target, files);
    void t.run();
    return t;
  }

  getOutgoing(id: string): OutgoingTransfer | undefined {
    return this.outgoing.get(id);
  }

  cancelIncomingFile(transferId: string, fileId: string): void {
    this.incoming.get(transferId)?.cancelFile(fileId);
  }

  /**
   * Opened from a push notification: tell the sender we're here so it doesn't
   * have to wait for its next presence check.
   */
  async announceReady(transferId: string): Promise<void> {
    const row = await api.getTransfer(transferId);
    if (!row || row.to_device_id !== this.deps.self().id) return;
    if (row.status !== 'pending' && row.status !== 'p2p') return;
    await this.deps.signaling.send('transfer-accept', { to: row.from_device_id, transferId });
  }

  registerOutgoing(t: OutgoingTransfer): void {
    this.outgoing.set(t.id, t);
  }

  unregisterOutgoing(t: OutgoingTransfer): void {
    if (this.outgoing.get(t.id) === t) this.outgoing.delete(t.id);
  }

  unregisterIncoming(id: string): void {
    this.incoming.delete(id);
    this.finishedIncoming.add(id);
  }

  /** Dev/test only: drop every receiving connection to exercise reconnect + resume. */
  devDropConnections(): void {
    for (const t of this.incoming.values()) t.devDrop();
  }

  stop(): void {
    for (const off of this.offs) off();
    for (const t of this.outgoing.values()) t.cancel();
    for (const t of this.incoming.values()) t.close();
  }

  private async knownDevice(id: string): Promise<DeviceRow | undefined> {
    let d = this.deps.device(id);
    if (!d) {
      await this.deps.refreshDevices();
      d = this.deps.device(id);
    }
    return d && !d.revoked_at ? d : undefined;
  }

  private async onRequest(m: TransferRequestSignal): Promise<void> {
    if (this.finishedIncoming.has(m.transferId)) return;
    const from = await this.knownDevice(m.from);
    if (!from) return; // not one of our (active) devices: ignore
    if (!this.incoming.has(m.transferId)) {
      const t = new IncomingTransfer(this, m.transferId, from, m.fileCount, m.totalBytes);
      this.incoming.set(m.transferId, t);
      t.emit('connecting');
    }
    // Same user's device: accept automatically (that's the AirDrop part).
    await this.deps.signaling
      .send('transfer-accept', { to: m.from, transferId: m.transferId })
      .catch(() => {});
  }

  private async onOffer(m: OfferSignal): Promise<void> {
    if (this.finishedIncoming.has(m.transferId)) return;
    let t = this.incoming.get(m.transferId);
    if (!t) {
      // The request may have been missed (e.g. we were just opened from a
      // notification); an offer from one of our devices is enough.
      const from = await this.knownDevice(m.from);
      if (!from) return;
      const row = await api.getTransfer(m.transferId).catch(() => null);
      if (!row || row.to_device_id !== this.deps.self().id) return;
      t = new IncomingTransfer(this, m.transferId, from, row.file_count, row.total_bytes);
      this.incoming.set(m.transferId, t);
    }
    await t.handleOffer(m);
  }
}
