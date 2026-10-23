// Receiving side of the data-channel protocol for one transfer. The session
// outlives individual connection attempts: after a reconnect the new channel
// is attached and the sender re-sends file-meta for the file in progress. We
// answer with how many chunks are already on disk, so it resumes from there
// instead of starting the file over.
//
// Messages are processed strictly in order through one promise chain, and each
// chunk is written to the sink before the next message is handled. Memory stays
// bounded because the sender never has more than TRANSFER.ackWindowBytes
// unacknowledged, and we only ack after writing.

import { TRANSFER } from '../config';
import {
  decodeChunk,
  decodeControl,
  encodeControl,
  type ControlMessage,
  type FileMeta,
} from '../core/protocol';
import { Sha256 } from '../core/sha256';
import type { FileSink, SavedFile, SinkFactory } from '../core/sink';

export interface ReceivedFileEvent {
  id: string;
  meta: FileMeta;
  saved: SavedFile;
  /** Dev builds only: whether the SHA-256 matched the sender's. */
  checksumOk?: boolean;
}

export interface ReceiverEvents {
  onFileStart(meta: FileMeta): void;
  onProgress(id: string, bytes: number): void;
  onFileDone(e: ReceivedFileEvent): void;
  onFileCancelled(id: string): void;
  onFileError(id: string, message: string): void;
  /** Sender said bye. */
  onFinished(cancelled: boolean): void;
}

interface Current {
  meta: FileMeta;
  sink: FileSink;
  /** Chunks written to the sink = next chunk index expected. */
  chunks: number;
  bytes: number;
  sinceAck: number;
  hash: Sha256 | null;
}

export class ReceiverSession {
  private current: Current | null = null;
  private completed = new Set<string>();
  private cancelled = new Set<string>();
  private chain: Promise<void> = Promise.resolve();
  private channel: RTCDataChannel | null = null;
  private attempt = -1;
  private finished = false;

  constructor(
    private readonly createSink: SinkFactory,
    private readonly events: ReceiverEvents,
    private readonly checksum: boolean,
  ) {}

  get isFinished(): boolean {
    return this.finished;
  }

  /** Attach a (new) data channel. Messages from older attempts are ignored. */
  attach(channel: RTCDataChannel, attempt: number): void {
    this.channel = channel;
    this.attempt = attempt;
    channel.addEventListener('message', (ev: MessageEvent) => {
      if (this.attempt !== attempt) return;
      const data = ev.data as string | ArrayBuffer;
      this.chain = this.chain.then(() => this.handle(data)).catch((e) => this.onInternalError(e));
    });
  }

  /** User cancelled one file on the receiving side. */
  cancelFile(id: string): void {
    this.chain = this.chain.then(async () => {
      this.cancelled.add(id);
      if (this.current?.meta.id === id) await this.abortCurrent();
      this.send({ type: 'file-cancel', id });
      this.events.onFileCancelled(id);
    });
  }

  /** Give up on this transfer (sender never came back). Deletes the partial file. */
  async dispose(): Promise<void> {
    await this.chain.catch(() => {});
    await this.abortCurrent();
    this.channel = null;
  }

  private send(msg: ControlMessage): void {
    try {
      if (this.channel?.readyState === 'open') this.channel.send(encodeControl(msg));
    } catch {
      /* channel gone; the sender will reconnect and ask again */
    }
  }

  private async handle(data: string | ArrayBuffer): Promise<void> {
    if (typeof data !== 'string') return this.handleChunk(data);
    const msg = decodeControl(data);
    if (!msg) return;
    switch (msg.type) {
      case 'file-meta':
        return this.handleMeta(msg);
      case 'file-done':
        return this.handleDone(msg.id, msg.sha256);
      case 'file-cancel':
        if (this.current?.meta.id === msg.id) await this.abortCurrent();
        this.events.onFileCancelled(msg.id);
        return;
      case 'bye':
        this.finished = true;
        await this.abortCurrent();
        this.events.onFinished(msg.cancelled === true);
        return;
      default:
        return;
    }
  }

  private async handleMeta(meta: FileMeta & { type: 'file-meta' }): Promise<void> {
    if (this.completed.has(meta.id)) {
      // Finished before the connection dropped; just confirm.
      this.send({
        type: 'ack',
        id: meta.id,
        chunk: Math.ceil(meta.size / TRANSFER.p2pChunkBytes),
        done: true,
      });
      return;
    }
    if (this.cancelled.has(meta.id)) {
      this.send({ type: 'file-cancel', id: meta.id });
      return;
    }
    if (this.current?.meta.id === meta.id) {
      // Reconnected mid-file: resume.
      if (this.checksum) console.info(`[dev] resuming at chunk ${this.current.chunks}`);
      this.send({ type: 'ack', id: meta.id, chunk: this.current.chunks });
      return;
    }
    // The sender moved on from whatever was in progress.
    await this.abortCurrent();

    const { type: _type, ...info } = meta;
    let sink: FileSink;
    try {
      sink = await this.createSink(info);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Could not save file';
      this.send({ type: 'error', id: meta.id, message });
      this.events.onFileError(meta.id, message);
      return;
    }
    this.current = {
      meta: info,
      sink,
      chunks: 0,
      bytes: 0,
      sinceAck: 0,
      hash: this.checksum ? new Sha256() : null,
    };
    this.events.onFileStart(info);
    this.send({ type: 'ack', id: meta.id, chunk: 0 });
  }

  private async handleChunk(buf: ArrayBuffer): Promise<void> {
    const cur = this.current;
    const chunk = decodeChunk(buf, TRANSFER.p2pChunkBytes);
    if (!cur || !chunk || chunk.fileId !== cur.meta.id) return;
    if (chunk.index < cur.chunks) return; // duplicate after a resume
    if (chunk.index > cur.chunks || cur.bytes + chunk.data.byteLength > cur.meta.size) {
      await this.failCurrent('Received data out of order');
      return;
    }
    await cur.sink.write(chunk.data);
    cur.hash?.update(chunk.data);
    cur.chunks++;
    cur.bytes += chunk.data.byteLength;
    cur.sinceAck += chunk.data.byteLength;
    this.events.onProgress(cur.meta.id, cur.bytes);
    if (cur.sinceAck >= TRANSFER.ackEveryBytes) {
      cur.sinceAck = 0;
      this.send({ type: 'ack', id: cur.meta.id, chunk: cur.chunks });
    }
  }

  private async handleDone(id: string, sha256: string | undefined): Promise<void> {
    const cur = this.current;
    if (!cur || cur.meta.id !== id) return;
    if (cur.bytes !== cur.meta.size) {
      await this.failCurrent('File arrived incomplete');
      return;
    }
    const saved = await cur.sink.close();
    this.current = null;
    this.completed.add(id);
    const hex = cur.hash?.hex();
    const checksumOk = hex && sha256 ? hex === sha256 : undefined;
    // Dev builds only (checksum is off in production): lets tests compare with `shasum`.
    if (hex) console.info(`[dev] received sha256 ${hex} ok=${checksumOk}`);
    if (checksumOk === false) console.error('[receiver] checksum mismatch for file', id);
    this.send({ type: 'ack', id, chunk: cur.chunks, done: true });
    this.events.onFileDone({ id, meta: cur.meta, saved, checksumOk });
  }

  private async failCurrent(message: string): Promise<void> {
    const cur = this.current;
    if (!cur) return;
    await this.abortCurrent();
    this.send({ type: 'error', id: cur.meta.id, message });
    this.events.onFileError(cur.meta.id, message);
  }

  private async abortCurrent(): Promise<void> {
    const cur = this.current;
    this.current = null;
    if (cur) await cur.sink.abort().catch(() => {});
  }

  private onInternalError(e: unknown): void {
    // Typically a disk error (full disk, permission revoked). Fail the current
    // file but keep the session usable for the rest.
    const message =
      e instanceof Error && /Quota/i.test(e.name) ? 'Out of storage space' : 'Could not write file';
    console.error('[receiver] write failed', e instanceof Error ? e.name : e);
    void this.failCurrent(message);
  }
}
