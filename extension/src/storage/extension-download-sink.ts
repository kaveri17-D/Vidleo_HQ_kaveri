import type { MediaSink } from '../../../frontend/src/packages/media-engine/sink/sink';

/**
 * ExtensionDownloadSink
 * 
 * Streams media directly into the browser's Origin Private File System (OPFS)
 * within the Chrome Manifest V3 Offscreen Document execution context.
 * 
 * Memory Safety:
 * - Employs strict streaming writes via FileSystemWritableFileStream.
 * - Memory growth is strictly O(1) buffer reuse; no whole-file memory accumulation.
 * - Fails fast with an explicit OPFS_UNAVAILABLE error if OPFS is not supported
 *   or file handle creation fails, strictly avoiding unbounded in-memory fallback.
 */
export class ExtensionDownloadSink implements MediaSink {
  private fileHandle: any = null;
  private writable: any = null;
  private filename: string = '';
  private mimeType: string = 'video/mp4';
  private isOpfs: boolean = false;
  private blobUrl: string | null = null;
  private fileBlob: Blob | null = null;

  async open(filename: string, expectedSize?: number, mimeType?: string): Promise<void> {
    this.filename = filename;
    this.mimeType = mimeType || 'video/mp4';
    this.blobUrl = null;
    this.fileBlob = null;
    this.isOpfs = false;

    if (typeof navigator === 'undefined' || !(navigator as any).storage?.getDirectory) {
      throw new Error('OPFS_UNAVAILABLE: Origin Private File System is not supported in this runtime environment');
    }

    try {
      const root = await (navigator as any).storage.getDirectory();
      this.fileHandle = await root.getFileHandle(filename, { create: true });
      this.writable = await this.fileHandle.createWritable();
      this.isOpfs = true;
    } catch (err: any) {
      this.isOpfs = false;
      throw new Error(`OPFS_UNAVAILABLE: Failed to initialize OPFS storage for "${filename}": ${err?.message || err}`);
    }
  }

  async write(chunk: Uint8Array): Promise<void> {
    if (!this.isOpfs || !this.writable) {
      throw new Error('ExtensionDownloadSink: Sink is not open for writing');
    }
    await this.writable.write(chunk);
  }

  async close(): Promise<Blob> {
    if (!this.isOpfs || !this.writable) {
      throw new Error('ExtensionDownloadSink: Sink was not open or already closed');
    }

    await this.writable.close();
    this.writable = null;

    if (this.fileHandle) {
      this.fileBlob = await this.fileHandle.getFile();
      if (this.fileBlob && typeof URL !== 'undefined' && URL.createObjectURL) {
        this.blobUrl = URL.createObjectURL(this.fileBlob);
      }
      return this.fileBlob!;
    }

    throw new Error('ExtensionDownloadSink: File handle unavailable upon closing');
  }

  getBlobUrl(): string | null {
    return this.blobUrl;
  }

  getBlob(): Blob | null {
    return this.fileBlob;
  }

  async abort(): Promise<void> {
    if (this.writable) {
      try {
        await this.writable.abort();
      } catch {}
      this.writable = null;
    }
    await this.cleanup();
  }

  async cleanup(): Promise<void> {
    if (this.blobUrl && typeof URL !== 'undefined' && URL.revokeObjectURL) {
      URL.revokeObjectURL(this.blobUrl);
      this.blobUrl = null;
    }
    if (this.isOpfs && this.filename && typeof navigator !== 'undefined' && (navigator as any).storage?.getDirectory) {
      try {
        const root = await (navigator as any).storage.getDirectory();
        await root.removeEntry(this.filename);
      } catch {}
    }
    this.fileHandle = null;
    this.fileBlob = null;
    this.isOpfs = false;
  }
}

export type { MediaSink };
