// Web Push payload. Sent by the notify-device Edge Function, shown by the
// service worker. Kept tiny (push services cap payloads at ~4 KB) and
// validated on receipt, because it ends up in a system notification.

import { describeFiles } from './format';

export interface PushPayload {
  v: 1;
  type: 'incoming';
  transferId: string;
  fromName: string;
  fileCount: number;
  totalBytes: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parsePushPayload(text: string): PushPayload | null {
  if (!text || text.length > 2048) return null;
  try {
    const p = JSON.parse(text);
    if (
      p?.v !== 1 ||
      p.type !== 'incoming' ||
      typeof p.transferId !== 'string' ||
      !UUID.test(p.transferId) ||
      typeof p.fromName !== 'string' ||
      !Number.isInteger(p.fileCount) ||
      p.fileCount < 1 ||
      !Number.isInteger(p.totalBytes) ||
      p.totalBytes < 0
    )
      return null;
    return {
      v: 1,
      type: 'incoming',
      transferId: p.transferId,
      fromName: p.fromName.slice(0, 60),
      fileCount: p.fileCount,
      totalBytes: p.totalBytes,
    };
  } catch {
    return null;
  }
}

/** "Toni's Pixel wants to send 3 files, 24 MB" */
export function pushNotificationContent(p: PushPayload): { title: string; body: string } {
  return {
    title: `${p.fromName} wants to send ${describeFiles(p.fileCount, p.totalBytes)}`,
    body: 'Tap to open DropLink and receive.',
  };
}
