// The sender's per-transfer list of files: one at a time, with progress and
// per-file cancel. Pure state machine; the engine drives it and the UI renders
// snapshots of it.

export type FileStatus = 'queued' | 'sending' | 'done' | 'cancelled' | 'failed';

export interface QueueItem {
  id: string;
  name: string;
  size: number;
  /** Bytes confirmed written by the receiver. */
  transferred: number;
  status: FileStatus;
  error?: string;
}

export class FileQueue {
  readonly items: QueueItem[];

  constructor(files: { id: string; name: string; size: number }[]) {
    this.items = files.map((f) => ({
      id: f.id,
      name: f.name,
      size: f.size,
      transferred: 0,
      status: 'queued',
    }));
  }

  /** Next file to send: the one in progress (after a reconnect) or the next queued one. */
  next(): QueueItem | undefined {
    return (
      this.items.find((i) => i.status === 'sending') ??
      this.items.find((i) => i.status === 'queued')
    );
  }

  start(id: string): void {
    const item = this.get(id);
    if (item.status === 'queued') item.status = 'sending';
  }

  progress(id: string, transferred: number): void {
    const item = this.get(id);
    item.transferred = Math.min(item.size, Math.max(item.transferred, transferred));
  }

  complete(id: string): void {
    const item = this.get(id);
    if (item.status === 'cancelled') return;
    item.status = 'done';
    item.transferred = item.size;
  }

  /** Returns true if the file was still pending (so the peer should be told). */
  cancel(id: string): boolean {
    const item = this.get(id);
    if (item.status === 'done' || item.status === 'cancelled' || item.status === 'failed')
      return false;
    item.status = 'cancelled';
    return true;
  }

  fail(id: string, error: string): void {
    const item = this.get(id);
    if (item.status === 'done' || item.status === 'cancelled') return;
    item.status = 'failed';
    item.error = error;
  }

  cancelAll(): string[] {
    return this.items.filter((i) => this.cancel(i.id)).map((i) => i.id);
  }

  get finished(): boolean {
    return this.items.every((i) => i.status !== 'queued' && i.status !== 'sending');
  }

  get totalBytes(): number {
    return this.items.reduce((s, i) => s + i.size, 0);
  }

  get transferredBytes(): number {
    return this.items.reduce((s, i) => s + (i.status === 'cancelled' ? 0 : i.transferred), 0);
  }

  /** Files not yet delivered (for retrying later via relay or outbox). */
  get remaining(): QueueItem[] {
    return this.items.filter(
      (i) => i.status === 'queued' || i.status === 'sending' || i.status === 'failed',
    );
  }

  snapshot(): QueueItem[] {
    return this.items.map((i) => ({ ...i }));
  }

  private get(id: string): QueueItem {
    const item = this.items.find((i) => i.id === id);
    if (!item) throw new Error(`Unknown file ${id}`);
    return item;
  }
}

/** Exponential backoff with jitter: 1s, 2s, 4s, 8s, 16s (+ up to 20%). */
export function backoffDelay(
  attempt: number,
  baseMs: number,
  maxMs = 30_000,
  random = Math.random,
): number {
  const d = Math.min(maxMs, baseMs * 2 ** attempt);
  return Math.round(d + d * 0.2 * random());
}
