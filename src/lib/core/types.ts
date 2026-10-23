export type DeviceKind = 'android' | 'mac' | 'windows' | 'linux' | 'ios' | 'other';

export type TransferStatus =
  'pending' | 'p2p' | 'relayed' | 'delivered' | 'failed' | 'cancelled' | 'expired';

export interface DeviceRow {
  id: string;
  user_id: string;
  name: string;
  kind: DeviceKind;
  public_key: JsonWebKey;
  created_at: string;
  last_seen_at: string;
  revoked_at: string | null;
}

export interface TransferRow {
  id: string;
  user_id: string;
  from_device_id: string;
  to_device_id: string;
  status: TransferStatus;
  file_count: number;
  total_bytes: number;
  relay_params: RelayParams | null;
  created_at: string;
  delivered_at: string | null;
  expires_at: string;
}

/** Stored on the transfer row so the receiver can derive the relay key. */
export interface RelayParams {
  v: 1;
  /** Sender's ephemeral ECDH P-256 public key. */
  epk: JsonWebKey;
  /** base64url HKDF salt (32 bytes). */
  salt: string;
  /** base64url 4-byte random IV prefix. */
  ivPrefix: string;
}
