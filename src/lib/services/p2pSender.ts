// Sends a queue of files over an open "files" data channel, one at a time.
// One call = one connection attempt. If the channel drops it throws
// ConnectionLost; the caller reconnects and calls again with the same queue,
// and the receiver's ack tells us where to resume.

import { TRANSFER } from '../config';
import { AckWindow, BackpressureSender, ChannelClosedError } from '../core/flow';
import type { FileQueue } from '../core/fileQueue';
import {
  decodeControl,
  encodeChunk,
  encodeControl,
  uuidToBytes,
  type ControlMessage,
} from '../core/protocol';
import { Sha256 } from '../core/sha256';
import type { SendFile } from '../core/sink';

export class ConnectionLost extends Error {
  constructor(message = 'Connection lost') {
    super(message);
    this.name = 'ConnectionLost';
  }
}

export class TransferCancelled extends Error {
  constructor() {
    super('Cancelled');
    this.name = 'AbortError';
  }
}

/** Read this much from disk at a time, then split into 64 KB messages. */
const READ_BLOCK = 1024 * 1024;
const META_ACK_TIMEOUT_MS = 20_000;
/** Max silence while waiting for the final ack (receiver flushing to disk). */
const DONE_ACK_IDLE_MS = 60_000;

export interface SendOptions {
  channel: RTCDataChannel;
  queue: FileQueue;
  files: Map<string, SendFile>;
  /** Called on any progress or status change. */
  onUpdate: () => void;
  /** Aborted when the user cancels the whole transfer. */
  signal: AbortSignal;
  /** Dev builds send a SHA-256 of each file so the receiver can verify it. */
  checksum: boolean;
}

type Waiter = {
  resolve: (m: ControlMessage) => void;
  reject: (e: Error) => void;
  timer?: ReturnType<typeof setTimeout>;
};

export async function sendOverChannel(opts: SendOptions): Promise<void> {
  const { channel, queue, files, onUpdate, signal } = opts;
  const tx = new BackpressureSender(
    channel,
    TRANSFER.bufferedHighWater,
    TRANSFER.bufferedLowThreshold,
  );
  const window = new AckWindow(TRANSFER.ackWindowBytes);
  const chunk = TRANSFER.p2pChunkBytes;

  let current: string | null = null;
  let waiter: Waiter | null = null;
  const receiverCancelled = new Set<string>();
  let lost: Error | null = null;
  /** True while waiting for the final ack of a file (intermediate acks extend the deadline). */
  let pendingDone = false;

  const failAll = (e: Error) => {
    lost = e;
    window.fail(e);
    if (waiter) {
      clearTimeout(waiter.timer);
      waiter.reject(e);
      waiter = null;
    }
  };

  const onMessage = (ev: MessageEvent) => {
    if (typeof ev.data !== 'string') return;
    const msg = decodeControl(ev.data);
    if (!msg || msg.type === 'bye' || msg.id !== current) {
      if (msg && msg.type === 'file-cancel') receiverCancelled.add(msg.id);
      return;
    }
    if (msg.type === 'ack') {
      window.ack(Math.min(msg.chunk * chunk, files.get(msg.id)!.size));
      queue.progress(msg.id, window.ackedBytes);
      onUpdate();
    } else if (msg.type === 'file-cancel') {
      receiverCancelled.add(msg.id);
      window.fail(new TransferCancelled());
    }
    if (waiter && (msg.type === 'ack' || msg.type === 'file-cancel' || msg.type === 'error')) {
      const w = waiter;
      // An intermediate ack while waiting for "done" just extends the deadline.
      if (msg.type === 'ack' && !msg.done && w.timer && pendingDone) {
        clearTimeout(w.timer);
        w.timer = setTimeout(
          () => failAll(new ConnectionLost('The other device stopped responding')),
          DONE_ACK_IDLE_MS,
        );
        return;
      }
      clearTimeout(w.timer);
      waiter = null;
      w.resolve(msg);
    }
  };

  const onClose = () => failAll(new ConnectionLost());
  const onAbort = () => failAll(new TransferCancelled());
  channel.addEventListener('message', onMessage);
  channel.addEventListener('close', onClose);
  signal.addEventListener('abort', onAbort);

  const waitFor = (ms: number) =>
    new Promise<ControlMessage>((resolve, reject) => {
      if (lost) return reject(lost);
      waiter = { resolve, reject };
      waiter.timer = setTimeout(
        () => failAll(new ConnectionLost('The other device stopped responding')),
        ms,
      );
    });

  try {
    for (let item = queue.next(); item; item = queue.next()) {
      if (signal.aborted) throw new TransferCancelled();
      const file = files.get(item.id)!;
      current = item.id;
      queue.start(item.id);
      onUpdate();

      await tx.send(
        encodeControl({
          type: 'file-meta',
          id: file.id,
          name: file.name,
          size: file.size,
          mimeType: file.mimeType,
          lastModified: file.lastModified,
          index: queue.items.findIndex((i) => i.id === file.id),
          total: queue.items.length,
        }),
      );
      const reply = await waitFor(META_ACK_TIMEOUT_MS);
      if (reply.type === 'file-cancel') {
        queue.cancel(item.id);
        onUpdate();
        continue;
      }
      if (reply.type !== 'ack') {
        queue.fail(
          item.id,
          reply.type === 'error' ? reply.message : 'Declined by the other device',
        );
        onUpdate();
        continue;
      }
      if (reply.done) {
        queue.complete(item.id);
        onUpdate();
        continue;
      }

      // Resume point: the receiver has `reply.chunk` chunks on disk already.
      const startByte = Math.min(reply.chunk * chunk, file.size);
      window.reset(startByte);
      queue.progress(item.id, startByte);
      const hash = opts.checksum ? new Sha256() : null;
      if (hash && startByte > 0) await hashRange(file.blob, 0, startByte, hash);

      const isCancelled = () =>
        receiverCancelled.has(file.id) ||
        queue.items.find((i) => i.id === file.id)!.status === 'cancelled';
      const status = await sendBody(file, startByte, hash, isCancelled);
      if (status === 'cancelled') {
        if (!receiverCancelled.has(file.id))
          await tx.send(encodeControl({ type: 'file-cancel', id: file.id }));
        queue.cancel(file.id);
        window.reset();
        onUpdate();
        continue;
      }

      pendingDone = true;
      await tx.send(
        encodeControl({ type: 'file-done', id: file.id, ...(hash ? { sha256: hash.hex() } : {}) }),
      );
      const done = await waitFor(DONE_ACK_IDLE_MS);
      pendingDone = false;
      if (done.type === 'ack' && done.done) queue.complete(file.id);
      else if (done.type === 'file-cancel') queue.cancel(file.id);
      else queue.fail(file.id, done.type === 'error' ? done.message : 'Failed on the other device');
      onUpdate();
    }
    current = null;
    await tx.send(encodeControl({ type: 'bye' }));
  } catch (e) {
    if (e instanceof TransferCancelled && signal.aborted) {
      // Best effort: tell the receiver so it can delete the partial file.
      try {
        if (current) channel.send(encodeControl({ type: 'file-cancel', id: current }));
        channel.send(encodeControl({ type: 'bye', cancelled: true }));
      } catch {
        /* channel already gone */
      }
      throw e;
    }
    if (e instanceof ChannelClosedError || e instanceof ConnectionLost)
      throw new ConnectionLost(e.message);
    throw e;
  } finally {
    channel.removeEventListener('message', onMessage);
    channel.removeEventListener('close', onClose);
    signal.removeEventListener('abort', onAbort);
  }

  async function sendBody(
    file: SendFile,
    startByte: number,
    hash: Sha256 | null,
    isCancelled: () => boolean,
  ): Promise<'sent' | 'cancelled'> {
    const idBytes = uuidToBytes(file.id);
    let index = startByte / chunk;
    // Read the next block while the current one is being sent.
    let next = readBlock(file.blob, startByte);
    for (let offset = startByte; offset < file.size;) {
      const block = await next;
      const nextOffset = offset + block.byteLength;
      next =
        nextOffset < file.size
          ? readBlock(file.blob, nextOffset)
          : Promise.resolve(new Uint8Array(0));
      hash?.update(block);
      for (let p = 0; p < block.byteLength; p += chunk) {
        if (isCancelled()) return 'cancelled';
        if (lost) throw lost;
        const part = block.subarray(p, p + chunk);
        try {
          await window.reserve(part.byteLength);
        } catch (e) {
          if (e instanceof TransferCancelled && isCancelled()) return 'cancelled';
          throw e;
        }
        await tx.send(encodeChunk(idBytes, index++, part));
      }
      offset = nextOffset;
    }
    return isCancelled() ? 'cancelled' : 'sent';
  }
}

async function readBlock(blob: Blob, offset: number): Promise<Uint8Array> {
  return new Uint8Array(await blob.slice(offset, offset + READ_BLOCK).arrayBuffer());
}

async function hashRange(blob: Blob, start: number, end: number, hash: Sha256): Promise<void> {
  for (let o = start; o < end; o += READ_BLOCK) {
    hash.update(new Uint8Array(await blob.slice(o, Math.min(end, o + READ_BLOCK)).arrayBuffer()));
  }
}
