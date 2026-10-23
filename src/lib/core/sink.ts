// Where received bytes go. Implementations live in services/sinks.ts (a
// folder picked with the File System Access API, OPFS + download, or an
// in-memory Blob). The P2P receiver and the relay downloader both write
// through this interface, strictly in order.

export interface IncomingFileInfo {
  name: string;
  size: number;
  mimeType: string;
  lastModified: number;
}

export interface SavedFile {
  /** Final name on disk (after collision renaming), or the download name. */
  savedName: string;
  /** Where it ended up, for the UI. */
  location: 'folder' | 'download' | 'text';
  /** For shared text items: the text itself (shown with a copy button). */
  text?: string;
}

export interface FileSink {
  write(data: Uint8Array): Promise<void>;
  close(): Promise<SavedFile>;
  abort(): Promise<void>;
}

export type SinkFactory = (info: IncomingFileInfo) => Promise<FileSink>;

/** A file the user wants to send (from the picker, drag and drop, or the share target). */
export interface SendFile {
  id: string;
  blob: Blob;
  name: string;
  size: number;
  mimeType: string;
  lastModified: number;
}
