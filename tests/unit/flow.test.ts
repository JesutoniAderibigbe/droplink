import { describe, expect, it } from 'vitest';
import {
  AckWindow,
  BackpressureSender,
  ChannelClosedError,
  type ChannelLike,
} from '../../src/lib/core/flow';
import { FileQueue, backoffDelay } from '../../src/lib/core/fileQueue';

/** Fake RTCDataChannel: buffers until drain() is called, like SCTP would. */
class FakeChannel implements ChannelLike {
  readyState = 'open';
  bufferedAmount = 0;
  bufferedAmountLowThreshold = 0;
  sent: (string | ArrayBuffer)[] = [];
  peak = 0;
  private listeners = new Map<string, Set<() => void>>();

  send(data: string | ArrayBuffer) {
    this.sent.push(data);
    this.bufferedAmount += typeof data === 'string' ? data.length : data.byteLength;
    this.peak = Math.max(this.peak, this.bufferedAmount);
  }
  addEventListener(type: string, fn: () => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
  }
  removeEventListener(type: string, fn: () => void) {
    this.listeners.get(type)?.delete(fn);
  }
  emit(type: string) {
    for (const fn of [...(this.listeners.get(type) ?? [])]) fn();
  }
  /** Network drained some bytes; fire bufferedamountlow when crossing the threshold. */
  drain(bytes: number) {
    const before = this.bufferedAmount;
    this.bufferedAmount = Math.max(0, this.bufferedAmount - bytes);
    if (
      before > this.bufferedAmountLowThreshold &&
      this.bufferedAmount <= this.bufferedAmountLowThreshold
    )
      this.emit('bufferedamountlow');
  }
  listenerCount() {
    return [...this.listeners.values()].reduce((n, s) => n + s.size, 0);
  }
}

const KB = 1024;
const MB = 1024 * KB;
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('BackpressureSender', () => {
  it('sets the low threshold and never lets the buffer grow far past high water', async () => {
    const ch = new FakeChannel();
    const tx = new BackpressureSender(ch, 8 * MB, 1 * MB);
    expect(ch.bufferedAmountLowThreshold).toBe(1 * MB);

    // Simulate a slow network: drain 512 KB every tick while sending 1 GB.
    const chunk = new ArrayBuffer(64 * KB);
    let stop = false;
    const pump = (async () => {
      while (!stop) {
        await tick();
        ch.drain(512 * KB);
      }
    })();
    for (let i = 0; i < (1024 * MB) / chunk.byteLength; i++) await tx.send(chunk);
    stop = true;
    await pump;

    expect(ch.sent.length).toBe(16384);
    expect(ch.peak).toBeLessThanOrEqual(8 * MB + 64 * KB);
    expect(ch.listenerCount()).toBe(0); // no leaked listeners
  });

  it('rejects waiting sends when the channel closes', async () => {
    const ch = new FakeChannel();
    const tx = new BackpressureSender(ch, 100, 10);
    await tx.send(new ArrayBuffer(200));
    const pending = tx.send(new ArrayBuffer(10));
    ch.readyState = 'closed';
    ch.emit('close');
    await expect(pending).rejects.toBeInstanceOf(ChannelClosedError);
    await expect(tx.send('x')).rejects.toBeInstanceOf(ChannelClosedError);
  });
});

describe('AckWindow', () => {
  it('blocks when the window is full and resumes on ack', async () => {
    const w = new AckWindow(4);
    await w.reserve(2);
    await w.reserve(2);
    let resumed = false;
    const p = w.reserve(2).then(() => (resumed = true));
    await tick();
    expect(resumed).toBe(false);
    w.ack(2);
    await p;
    expect(resumed).toBe(true);
  });

  it('always lets a single oversized reservation through', async () => {
    const w = new AckWindow(4);
    await w.reserve(10);
  });

  it('can be failed to unblock a waiting sender', async () => {
    const w = new AckWindow(1);
    await w.reserve(1);
    const p = w.reserve(1);
    w.fail(new Error('lost'));
    await expect(p).rejects.toThrow('lost');
  });

  it('resets to a resume point', async () => {
    const w = new AckWindow(4);
    w.reset(100);
    expect(w.ackedBytes).toBe(100);
    await w.reserve(4);
    w.ack(104);
    expect(w.ackedBytes).toBe(104);
  });
});

describe('FileQueue', () => {
  const files = [
    { id: 'a', name: 'a.jpg', size: 10 },
    { id: 'b', name: 'b.jpg', size: 20 },
    { id: 'c', name: 'c.jpg', size: 30 },
  ];

  it('sends one at a time, in order, and keeps the in-progress file after a reconnect', () => {
    const q = new FileQueue(files);
    expect(q.next()!.id).toBe('a');
    q.start('a');
    q.progress('a', 5);
    expect(q.next()!.id).toBe('a'); // still a
    q.complete('a');
    expect(q.next()!.id).toBe('b');
    expect(q.transferredBytes).toBe(10);
  });

  it('cancels individual files and the rest', () => {
    const q = new FileQueue(files);
    q.start('a');
    expect(q.cancel('b')).toBe(true);
    expect(q.cancel('b')).toBe(false);
    q.complete('a');
    expect(q.next()!.id).toBe('c');
    expect(q.cancelAll()).toEqual(['c']);
    expect(q.finished).toBe(true);
    expect(q.remaining).toHaveLength(0);
  });

  it('progress never goes backwards or past the size', () => {
    const q = new FileQueue(files);
    q.progress('a', 8);
    q.progress('a', 3);
    expect(q.items[0].transferred).toBe(8);
    q.progress('a', 999);
    expect(q.items[0].transferred).toBe(10);
  });

  it('reports failed files as remaining', () => {
    const q = new FileQueue(files);
    q.fail('a', 'x');
    q.complete('b');
    expect(q.remaining.map((i) => i.id)).toEqual(['a', 'c']);
  });
});

describe('backoffDelay', () => {
  it('doubles up to the cap', () => {
    const r = () => 0;
    expect([0, 1, 2, 3, 4].map((a) => backoffDelay(a, 1000, 30000, r))).toEqual([
      1000, 2000, 4000, 8000, 16000,
    ]);
    expect(backoffDelay(10, 1000, 30000, r)).toBe(30000);
    expect(backoffDelay(0, 1000, 30000, () => 1)).toBe(1200);
  });
});
