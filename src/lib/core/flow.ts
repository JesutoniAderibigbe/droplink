// Flow control for the sending side of a data channel. Two independent limits:
//
// 1. Backpressure on the local SCTP buffer. RTCDataChannel.send() never blocks:
//    it queues in memory, and a browser closes the channel if that queue gets
//    too big (and a phone may run out of memory long before). So we pause when
//    bufferedAmount goes over a high-water mark and resume on the
//    "bufferedamountlow" event, which fires when the buffer drains below
//    bufferedAmountLowThreshold.
//
// 2. An ack window across the connection. Even with a drained local buffer,
//    the receiver might be writing to disk more slowly than the network
//    delivers. Its in-memory write queue would then grow without bound. The
//    receiver acks chunks after they hit disk, and we never have more than
//    `windowBytes` sent-but-unacked. That bounds memory on the receiver and
//    gives us a resume point after a reconnect.

export interface ChannelLike {
  readonly readyState: string;
  bufferedAmount: number;
  bufferedAmountLowThreshold: number;
  send(data: string | ArrayBuffer): void;
  addEventListener(type: 'bufferedamountlow' | 'close' | 'error', listener: () => void): void;
  removeEventListener(type: 'bufferedamountlow' | 'close' | 'error', listener: () => void): void;
}

export class ChannelClosedError extends Error {
  constructor() {
    super('Data channel closed');
    this.name = 'ChannelClosedError';
  }
}

export class BackpressureSender {
  constructor(
    private readonly channel: ChannelLike,
    private readonly highWater: number,
    lowThreshold: number,
  ) {
    channel.bufferedAmountLowThreshold = lowThreshold;
  }

  /** Resolves once `data` has been queued and the buffer is below high water. */
  async send(data: string | ArrayBuffer): Promise<void> {
    if (this.channel.readyState !== 'open') throw new ChannelClosedError();
    if (this.channel.bufferedAmount > this.highWater) await this.drained();
    if (this.channel.readyState !== 'open') throw new ChannelClosedError();
    this.channel.send(data);
  }

  private drained(): Promise<void> {
    return new Promise((resolve, reject) => {
      const done = (fn: () => void) => () => {
        this.channel.removeEventListener('bufferedamountlow', onLow);
        this.channel.removeEventListener('close', onClose);
        this.channel.removeEventListener('error', onClose);
        fn();
      };
      const onLow = done(resolve);
      const onClose = done(() => reject(new ChannelClosedError()));
      this.channel.addEventListener('bufferedamountlow', onLow);
      this.channel.addEventListener('close', onClose);
      this.channel.addEventListener('error', onClose);
    });
  }
}

/** Tracks sent vs. acknowledged bytes and makes the sender wait when the window is full. */
export class AckWindow {
  private sent = 0;
  private acked = 0;
  private waiter: { resolve: () => void; reject: (e: Error) => void } | null = null;

  constructor(private readonly windowBytes: number) {}

  /** Reset for a new file (or a resume at `fromBytes`). */
  reset(fromBytes = 0): void {
    this.sent = fromBytes;
    this.acked = fromBytes;
    this.release();
  }

  get ackedBytes(): number {
    return this.acked;
  }

  async reserve(bytes: number): Promise<void> {
    while (this.sent - this.acked + bytes > this.windowBytes && this.sent > this.acked) {
      await new Promise<void>((resolve, reject) => (this.waiter = { resolve, reject }));
    }
    this.sent += bytes;
  }

  ack(totalAckedBytes: number): void {
    if (totalAckedBytes > this.acked) this.acked = Math.min(totalAckedBytes, this.sent);
    this.release();
  }

  /** Wake a blocked sender with an error (connection lost / cancelled). */
  fail(error: Error): void {
    const w = this.waiter;
    this.waiter = null;
    w?.reject(error);
  }

  private release(): void {
    const w = this.waiter;
    this.waiter = null;
    w?.resolve();
  }
}
