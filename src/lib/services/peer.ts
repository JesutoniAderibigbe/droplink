// One WebRTC connection attempt for one transfer. The sender is the offerer
// and creates the single ordered, reliable "files" data channel; the receiver
// answers. Signaling goes over Supabase Broadcast (services/signaling.ts).
//
// Each reconnect is a brand-new PeerSession with attempt + 1; messages for
// older attempts are ignored by the router in services/transfers.ts.

import { TRANSFER } from '../config';
import type { SignalBus } from './signaling';

const CONNECT_TIMEOUT_MS = TRANSFER.connectTimeoutMs;
/** "disconnected" can recover on its own (e.g. a Wi-Fi blip); give it a moment. */
const DISCONNECTED_GRACE_MS = 6_000;

export class PeerSession {
  readonly pc: RTCPeerConnection;
  private pendingIce: RTCIceCandidateInit[] = [];
  private remoteSet = false;
  private closed = false;
  private failListeners = new Set<(reason: string) => void>();
  private disconnectTimer: ReturnType<typeof setTimeout> | undefined;
  readonly channel: Promise<RTCDataChannel>;

  constructor(
    private readonly opts: {
      signaling: SignalBus;
      transferId: string;
      peerId: string;
      attempt: number;
      role: 'offerer' | 'answerer';
      iceServers: RTCIceServer[];
    },
  ) {
    this.pc = new RTCPeerConnection({ iceServers: opts.iceServers });

    this.pc.onicecandidate = (e) => {
      void this.signal('ice', { candidate: e.candidate ? e.candidate.toJSON() : null });
    };
    this.pc.onconnectionstatechange = () => {
      const s = this.pc.connectionState;
      if (s === 'failed') this.fail('connection failed');
      else if (s === 'disconnected') {
        clearTimeout(this.disconnectTimer);
        this.disconnectTimer = setTimeout(() => {
          if (this.pc.connectionState === 'disconnected') this.fail('connection lost');
        }, DISCONNECTED_GRACE_MS);
      } else if (s === 'connected') clearTimeout(this.disconnectTimer);
    };

    this.channel = new Promise<RTCDataChannel>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Timed out connecting to the other device')),
        CONNECT_TIMEOUT_MS,
      );
      this.onFail((reason) => {
        clearTimeout(timer);
        reject(new Error(reason));
      });
      const ready = (ch: RTCDataChannel) => {
        ch.binaryType = 'arraybuffer';
        const open = () => {
          clearTimeout(timer);
          resolve(ch);
        };
        if (ch.readyState === 'open') open();
        else ch.addEventListener('open', open, { once: true });
        ch.addEventListener('close', () => this.fail('data channel closed'));
      };
      if (opts.role === 'offerer') ready(this.pc.createDataChannel('files', { ordered: true }));
      else this.pc.ondatachannel = (e) => e.channel.label === 'files' && ready(e.channel);
    });
    // Avoid unhandled rejections if nobody awaits the channel (e.g. closed early).
    this.channel.catch(() => {});
  }

  get attempt(): number {
    return this.opts.attempt;
  }

  /** Offerer: create and send the offer. */
  async start(): Promise<void> {
    // Dev/test only: pretend the networks block direct connections.
    if (import.meta.env.DEV && localStorage.getItem('droplink:dev-no-p2p') === '1') return;
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    await this.signal('offer', { sdp: offer.sdp ?? '' });
  }

  /** Answerer: apply the offer and reply. */
  async acceptOffer(sdp: string): Promise<void> {
    await this.pc.setRemoteDescription({ type: 'offer', sdp });
    await this.flushIce();
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    await this.signal('answer', { sdp: answer.sdp ?? '' });
  }

  /** Offerer: apply the answer. */
  async acceptAnswer(sdp: string): Promise<void> {
    if (this.pc.signalingState !== 'have-local-offer') return;
    await this.pc.setRemoteDescription({ type: 'answer', sdp });
    await this.flushIce();
  }

  /** Candidates can arrive before the remote description; queue them until then. */
  async addIce(candidate: RTCIceCandidateInit | null): Promise<void> {
    if (!candidate) return;
    if (!this.remoteSet) {
      this.pendingIce.push(candidate);
      return;
    }
    try {
      await this.pc.addIceCandidate(candidate);
    } catch (e) {
      console.warn('[peer] bad ice candidate', (e as Error).message);
    }
  }

  onFail(fn: (reason: string) => void): () => void {
    this.failListeners.add(fn);
    return () => this.failListeners.delete(fn);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.disconnectTimer);
    this.failListeners.clear();
    try {
      this.pc.close();
    } catch {
      /* already closed */
    }
  }

  /**
   * Which path the connection took, from WebRTC stats:
   *   lan      both ends use local addresses (same Wi-Fi / hotspot): fastest
   *   internet direct through the routers (speed = internet upload)
   *   turn     bounced through the TURN relay server
   */
  async route(): Promise<'lan' | 'internet' | 'turn' | null> {
    try {
      const stats = await this.pc.getStats();
      let pairId: string | undefined;
      stats.forEach((r) => {
        if (r.type === 'transport' && r.selectedCandidatePairId) pairId = r.selectedCandidatePairId;
      });
      let pair: RTCIceCandidatePairStats | undefined;
      stats.forEach((r) => {
        if (r.type !== 'candidate-pair') return;
        if (pairId ? r.id === pairId : r.nominated && r.state === 'succeeded') pair = r;
      });
      if (!pair) return null;
      const local = stats.get(pair.localCandidateId);
      const remote = stats.get(pair.remoteCandidateId);
      const types = [local?.candidateType, remote?.candidateType];
      if (types.includes('relay')) return 'turn';
      if (types.every((t) => t === 'host')) return 'lan';
      return 'internet';
    } catch {
      return null;
    }
  }

  /** Tear the connection down as if the network failed (dev/test hook). */
  simulateFailure(): void {
    this.fail('simulated network failure');
  }

  get isClosed(): boolean {
    return this.closed;
  }

  private fail(reason: string): void {
    if (this.closed) return;
    for (const fn of [...this.failListeners]) fn(reason);
    this.close();
  }

  private async flushIce(): Promise<void> {
    this.remoteSet = true;
    const queued = this.pendingIce;
    this.pendingIce = [];
    for (const c of queued) await this.addIce(c);
  }

  private async signal(
    type: 'offer' | 'answer' | 'ice',
    body: { sdp?: string; candidate?: RTCIceCandidateInit | null },
  ) {
    if (this.closed) return;
    const base = {
      to: this.opts.peerId,
      transferId: this.opts.transferId,
      attempt: this.opts.attempt,
    };
    try {
      if (type === 'ice')
        await this.opts.signaling.send('ice', { ...base, candidate: body.candidate ?? null });
      else await this.opts.signaling.send(type, { ...base, sdp: body.sdp ?? '' });
    } catch (e) {
      console.warn('[peer] signaling send failed', type, (e as Error).message);
      if (type !== 'ice') this.fail('signaling unavailable');
    }
  }
}
