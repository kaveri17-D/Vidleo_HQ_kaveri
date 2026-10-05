export interface MediaSink {
  open(filename: string, expectedSize?: number, mimeType?: string): Promise<void>;
  write(chunk: Uint8Array, position?: number): Promise<void>;
  close(): Promise<Blob | void>;
  abort(): Promise<void>;
}

export class FileSystemAccessSink implements MediaSink {
  private writable: any = null;
  private filename: string = '';
  private writeChain: Promise<void> = Promise.resolve();
  private bytesWritten: number = 0;
  private writeError: Error | null = null;

  async open(filename: string, expectedSize?: number, mimeType?: string): Promise<void> {
    this.filename = filename;
    this.bytesWritten = 0;
    this.writeError = null;
    this.writeChain = Promise.resolve();

    if (typeof window === 'undefined' || !(window as any).showSaveFilePicker) {
      throw new Error('File System Access API is not supported in this browser');
    }

    const ext = filename.split('.').pop() || 'mp4';
    const handle = await (window as any).showSaveFilePicker({
      suggestedName: filename,
      types: [
        {
          description: 'Video file',
          accept: {
            [mimeType || (ext === 'webm' ? 'video/webm' : 'video/mp4')]: [`.${ext}`],
          },
        },
      ],
    });

    this.writable = await handle.createWritable();
  }

  async write(chunk: Uint8Array, position?: number): Promise<void> {
    if (!this.writable) {
      throw new Error('Sink is not open for writing');
    }
    if (this.writeError) {
      throw this.writeError;
    }

    this.writeChain = this.writeChain.then(async () => {
      if (!this.writable) return;
      try {
        if (typeof position === 'number') {
          await this.writable.write({
            type: 'write',
            data: chunk,
            position,
          });
        } else {
          await this.writable.write(chunk);
        }
        this.bytesWritten += chunk.byteLength;
      } catch (err: any) {
        this.writeError = err;
        throw err;
      }
    });

    return this.writeChain;
  }

  async close(): Promise<void> {
    await this.writeChain;
    if (this.writeError) {
      throw this.writeError;
    }
    if (this.writable) {
      await this.writable.close();
      this.writable = null;
    }
    if (this.bytesWritten === 0) {
      throw new Error('File System write failed: 0 bytes written to destination file');
    }
  }

  async abort(): Promise<void> {
    this.writeError = null;
    if (this.writable) {
      try {
        await this.writable.abort();
      } catch {}
      this.writable = null;
    }
  }
}

export class OPFSSink implements MediaSink {
  private fileHandle: any = null;
  private writable: any = null;
  private filename: string = '';
  private writeChain: Promise<void> = Promise.resolve();
  private bytesWritten: number = 0;
  private writeError: Error | null = null;

  async open(filename: string): Promise<void> {
    this.filename = filename;
    this.bytesWritten = 0;
    this.writeError = null;
    this.writeChain = Promise.resolve();

    if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) {
      throw new Error('OPFS is not supported in this browser');
    }

    const root = await navigator.storage.getDirectory();
    this.fileHandle = await root.getFileHandle(filename, { create: true });
    this.writable = await this.fileHandle.createWritable();
  }

  async write(chunk: Uint8Array, position?: number): Promise<void> {
    if (!this.writable) {
      throw new Error('Sink is not open for writing');
    }
    if (this.writeError) {
      throw this.writeError;
    }

    this.writeChain = this.writeChain.then(async () => {
      if (!this.writable) return;
      try {
        if (typeof position === 'number') {
          await this.writable.write({
            type: 'write',
            data: chunk,
            position,
          });
        } else {
          await this.writable.write(chunk);
        }
        this.bytesWritten += chunk.byteLength;
      } catch (err: any) {
        this.writeError = err;
        throw err;
      }
    });

    return this.writeChain;
  }

  async close(): Promise<Blob> {
    await this.writeChain;
    if (this.writeError) {
      throw this.writeError;
    }
    if (this.writable) {
      await this.writable.close();
      this.writable = null;
    }
    if (this.bytesWritten === 0) {
      throw new Error('OPFS write failed: 0 bytes written');
    }
    if (this.fileHandle) {
      const file = await this.fileHandle.getFile();
      return file;
    }
    throw new Error('File handle not found');
  }

  async abort(): Promise<void> {
    this.writeError = null;
    if (this.writable) {
      try {
        await this.writable.abort();
      } catch {}
      this.writable = null;
    }
  }
}

export class BlobSink implements MediaSink {
  private chunks: Uint8Array[] = [];
  private mimeType: string = 'video/mp4';
  private totalBytes: number = 0;

  async open(filename: string, expectedSize?: number, mimeType?: string): Promise<void> {
    this.chunks = [];
    this.totalBytes = 0;
    this.mimeType = mimeType || 'video/mp4';
  }

  async write(chunk: Uint8Array, position?: number): Promise<void> {
    this.chunks.push(chunk);
    this.totalBytes += chunk.byteLength;
  }

  async close(): Promise<Blob> {
    if (this.totalBytes === 0) {
      throw new Error('BlobSink write failed: 0 bytes collected');
    }
    const blob = new Blob(this.chunks, { type: this.mimeType });
    this.chunks = [];
    return blob;
  }

  async abort(): Promise<void> {
    this.chunks = [];
    this.totalBytes = 0;
  }
}

