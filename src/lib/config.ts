// App-wide constants. The relay limits are mirrored in Postgres
// (supabase/migrations/*_schema.sql, private.limit_* functions), which is the
// authority; these exist so the UI can explain a limit before hitting it.

const MiB = 1024 * 1024;

export const LIMITS = {
  relayBytesPerTransfer: 100 * MiB,
  relayBytesPerDay: 500 * MiB,
  relayTransfersPerHour: 20,
  filesPerTransfer: 500,
  /** Max length of a file name we accept in metadata. */
  fileNameLength: 255,
  /** Shared text/URL items larger than this are rejected. */
  textItemBytes: 64 * 1024,
} as const;

export const TRANSFER = {
  /** WebRTC data channel payload per binary message. */
  p2pChunkBytes: 64 * 1024,
  /** Start refilling the channel when bufferedAmount drops below this. */
  bufferedLowThreshold: 1 * MiB,
  /** Stop sending when bufferedAmount goes above this. */
  bufferedHighWater: 8 * MiB,
  /** Max bytes sent but not yet acknowledged as written by the receiver. */
  ackWindowBytes: 16 * MiB,
  /** Receiver acks after writing this many bytes. */
  ackEveryBytes: 2 * MiB,
  /** How long the sender waits for the target to show up before relaying. */
  waitForTargetMs: 20_000,
  /** Relay plaintext chunk size. */
  relayChunkBytes: 1 * MiB,
  /** Reconnect attempts for a dropped P2P connection (exponential backoff). */
  reconnectAttempts: 5,
  /**
   * Attempts before giving up on a direct link that never connected at all
   * (strict NAT, no TURN): after this we fall back to the relay instead of
   * spending minutes on retries.
   */
  firstConnectAttempts: 1,
  /** How long one WebRTC connection attempt may take. */
  connectTimeoutMs: 10_000,
  reconnectBaseDelayMs: 1_000,
} as const;

export const PRESENCE = {
  lastSeenIntervalMs: 60_000,
} as const;

/** Marker MIME type for shared text/URL items sent as tiny "files". */
export const TEXT_ITEM_MIME = 'application/x-droplink-text';
