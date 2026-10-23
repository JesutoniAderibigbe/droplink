// Encrypted relay through Supabase Storage, for when the target device can't
// be reached directly.
//
// Upload (sender): set relay_params on the transfer (the server checks the
// hourly limit), then for each object: register it in relay_objects (the
// server checks size and daily quota and only then allows the Storage upload),
// encrypt, upload. Finally mark the transfer "relayed". The server only lets
// that happen if every registered object is in Storage and no bigger than
// declared.
//
// Download (receiver): derive the key with this device's private key, decrypt
// the manifest, then stream each chunk (download → decrypt → write) into the
// same sinks P2P uses, so a 100 MB relay never sits in memory. Afterwards mark
// "delivered" and delete the objects.
//
// Object paths: relay/{userId}/{transferId}/manifest and
//               relay/{userId}/{transferId}/{fileIndex}/{chunkIndex}

import { LIMITS, TRANSFER } from '../config';
import {
  decryptChunk,
  decryptManifest,
  encryptChunk,
  encryptManifest,
  fromB64url,
  receiverKey,
  senderKeys,
  type Manifest,
} from '../core/crypto';
import type { SavedFile, SendFile, SinkFactory } from '../core/sink';
import type { RelayParams, TransferRow } from '../core/types';
import { supabase } from '../supabase';
import * as api from './transfersApi';

const BUCKET = 'relay';
const MANIFEST_MAX = 1024 * 1024;
/** Parallel uploads/downloads: enough to fill the pipe, bounded memory (~N MB). */
const CONCURRENCY = 3;

export class RelayIneligible extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RelayIneligible';
  }
}

const objectPath = (userId: string, transferId: string, fileIndex: number, chunkIndex: number) =>
  `${userId}/${transferId}/${fileIndex}/${chunkIndex}`;
const manifestPath = (userId: string, transferId: string) => `${userId}/${transferId}/manifest`;

/** Today's relay usage (for a friendly message before the server says no). */
export async function relayBytesUsedToday(): Promise<number> {
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await supabase
    .from('usage_daily')
    .select('relay_bytes')
    .eq('day', today)
    .maybeSingle();
  return data?.relay_bytes ?? 0;
}

/** Client-side pre-check; the database enforces the same limits for real. */
export async function checkRelayEligible(totalBytes: number, files: SendFile[]): Promise<void> {
  if (totalBytes > LIMITS.relayBytesPerTransfer) throw new RelayIneligible('too_large');
  if (files.length > LIMITS.filesPerTransfer) throw new RelayIneligible('too many files');
  const plain = files.reduce((s, f) => s + f.size, 0);
  if ((await relayBytesUsedToday()) + plain > LIMITS.relayBytesPerDay)
    throw new RelayIneligible('quota_exceeded');
}

async function pool<T>(
  items: T[],
  n: number,
  fn: (item: T) => Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      signal?.throwIfAborted();
      await fn(items[next++]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
}

export interface UploadOptions {
  userId: string;
  transferId: string;
  targetPublicJwk: JsonWebKey;
  files: SendFile[];
  signal: AbortSignal;
  /** Plaintext bytes uploaded so far, per file id. */
  onProgress: (fileId: string, bytes: number) => void;
}

export async function uploadRelay(opts: UploadOptions): Promise<void> {
  const { userId, transferId, files, signal } = opts;
  const chunkBytes = TRANSFER.relayChunkBytes;
  const { key, params } = await senderKeys(opts.targetPublicJwk, transferId);
  const ivPrefix = fromB64url(params.ivPrefix);

  const manifest: Manifest = {
    v: 1,
    chunkBytes,
    files: files.map((f) => ({
      name: f.name.slice(0, LIMITS.fileNameLength),
      size: f.size,
      mimeType: f.mimeType,
      lastModified: f.lastModified,
      chunks: Math.ceil(f.size / chunkBytes),
    })),
  };
  const manifestCt = await encryptManifest(key, transferId, ivPrefix, manifest);
  if (manifestCt.byteLength > MANIFEST_MAX) throw new RelayIneligible('too many files');

  await api.startRelay(transferId, params as RelayParams);
  const uploaded: string[] = [];
  try {
    await putObject(manifestPath(userId, transferId), -1, 0, manifestCt);

    for (const [fileIndex, f] of files.entries()) {
      const chunks = manifest.files[fileIndex].chunks;
      let done = 0;
      await pool(
        Array.from({ length: chunks }, (_, i) => i),
        CONCURRENCY,
        async (chunkIndex) => {
          const start = chunkIndex * chunkBytes;
          const plain = new Uint8Array(await f.blob.slice(start, start + chunkBytes).arrayBuffer());
          const ct = await encryptChunk(
            key,
            { transferId, ivPrefix, fileIndex, chunkIndex, chunkCount: chunks },
            plain,
          );
          await putObject(
            objectPath(userId, transferId, fileIndex, chunkIndex),
            fileIndex,
            chunkIndex,
            ct,
          );
          done += plain.byteLength;
          opts.onProgress(f.id, done);
        },
        signal,
      );
      opts.onProgress(f.id, f.size);
    }
    await api.setTransferStatus(transferId, 'relayed');
  } catch (e) {
    // Don't leave half an upload behind (cleanup would get it, but sooner is better).
    if (uploaded.length)
      await supabase.storage
        .from(BUCKET)
        .remove(uploaded)
        .catch(() => {});
    await supabase
      .from('relay_objects')
      .delete()
      .eq('transfer_id', transferId)
      .then(
        () => {},
        () => {},
      );
    throw e;
  }

  async function putObject(
    path: string,
    fileIndex: number,
    chunkIndex: number,
    body: Uint8Array<ArrayBuffer>,
  ) {
    // Register first: this insert is where the server enforces quotas, and the
    // Storage policy only accepts paths registered here.
    const { error: regError } = await supabase.from('relay_objects').insert({
      transfer_id: transferId,
      user_id: userId,
      storage_path: path,
      file_index: fileIndex,
      chunk_index: chunkIndex,
      byte_size: body.byteLength,
    });
    if (regError) throw regError;
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, new Blob([body], { type: 'application/octet-stream' }), {
        contentType: 'application/octet-stream',
        upsert: false,
      });
    if (error) throw error;
    uploaded.push(path);
  }
}

// --- Download ---------------------------------------------------------------------

export interface DownloadEvents {
  onManifest(m: Manifest): void;
  onFileStart(fileIndex: number): void;
  onProgress(fileIndex: number, bytes: number): void;
  onFileDone(fileIndex: number, saved: SavedFile): void;
}

async function download(path: string): Promise<Uint8Array<ArrayBuffer>> {
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error || !data) throw error ?? new Error('download failed');
  return new Uint8Array(await data.arrayBuffer());
}

/**
 * Receive one relayed transfer. Chunks are fetched a few ahead in parallel
 * but written strictly in order, so memory stays at a few MB.
 */
export async function downloadRelay(
  row: TransferRow,
  devicePrivateKey: CryptoKey,
  sinkFactory: SinkFactory,
  events: DownloadEvents,
): Promise<void> {
  const params = row.relay_params!;
  const key = await receiverKey(devicePrivateKey, params, row.id);
  const ivPrefix = fromB64url(params.ivPrefix);
  const userId = row.user_id;
  const manifest = await decryptManifest(
    key,
    row.id,
    ivPrefix,
    await download(manifestPath(userId, row.id)),
  );
  events.onManifest(manifest);

  for (const [fileIndex, f] of manifest.files.entries()) {
    events.onFileStart(fileIndex);
    const sink = await sinkFactory({
      name: f.name,
      size: f.size,
      mimeType: f.mimeType,
      lastModified: f.lastModified,
    });
    try {
      const fetchChunk = async (chunkIndex: number) =>
        decryptChunk(
          key,
          { transferId: row.id, ivPrefix, fileIndex, chunkIndex, chunkCount: f.chunks },
          await download(objectPath(userId, row.id, fileIndex, chunkIndex)),
        );
      const inflight: Promise<Uint8Array<ArrayBuffer>>[] = [];
      let written = 0;
      for (let i = 0; i < f.chunks; i++) {
        while (inflight.length < CONCURRENCY && i + inflight.length < f.chunks) {
          const p = fetchChunk(i + inflight.length);
          p.catch(() => {}); // surfaced when awaited below; avoid unhandled rejections
          inflight.push(p);
        }
        const plain = await inflight.shift()!;
        await sink.write(plain);
        written += plain.byteLength;
        events.onProgress(fileIndex, written);
      }
      if (written !== f.size) throw new Error('Relay file is incomplete');
      events.onFileDone(fileIndex, await sink.close());
    } catch (e) {
      await sink.abort().catch(() => {});
      throw e;
    }
  }
}

/** Delete a relayed transfer's objects (after delivery, or on failure). */
export async function deleteRelayObjects(transferId: string): Promise<void> {
  const { data } = await supabase
    .from('relay_objects')
    .select('storage_path')
    .eq('transfer_id', transferId);
  const paths = (data ?? []).map((r) => r.storage_path);
  for (let i = 0; i < paths.length; i += 500) {
    await supabase.storage.from(BUCKET).remove(paths.slice(i, i + 500));
  }
  await supabase.from('relay_objects').delete().eq('transfer_id', transferId);
}
