declare namespace chrome {
  namespace runtime {
    const id: string;
    const lastError: { message?: string } | undefined;
    function getURL(path: string): string;
    function sendMessage(message: any, responseCallback?: (response: any) => void): Promise<any>;
    const onMessage: {
      addListener(
        callback: (
          message: any,
          sender: any,
          sendResponse: (response?: any) => void
        ) => boolean | void
      ): void;
      removeListener(callback: Function): void;
    };
    const onMessageExternal: {
      addListener(
        callback: (
          message: any,
          sender: any,
          sendResponse: (response?: any) => void
        ) => boolean | void
      ): void;
      removeListener(callback: Function): void;
    };
  }

  namespace tabs {
    interface Tab {
      id?: number;
      url?: string;
      title?: string;
      active?: boolean;
    }
    function query(queryInfo: { url?: string | string[]; active?: boolean; currentWindow?: boolean }, callback: (result: Tab[]) => void): void;
    function get(tabId: number, callback: (tab: Tab) => void): void;
    function create(createProperties: { url: string; active?: boolean }, callback?: (tab: Tab) => void): void;
    function sendMessage(tabId: number, message: any, responseCallback?: (response: any) => void): Promise<any>;
  }

  namespace webRequest {
    interface RequestFilter {
      urls: string[];
    }
    const onBeforeRequest: {
      addListener(
        callback: (details: { url: string; tabId: number; method: string; requestBody?: any }) => void,
        filter: RequestFilter,
        extraInfoSpec?: string[]
      ): void;
    };
  }

  namespace offscreen {
    enum Reason {
      BLOBS = 'BLOBS',
      AUDIO_PLAYBACK = 'AUDIO_PLAYBACK',
    }
    function hasDocument(): Promise<boolean>;
    function createDocument(parameters: {
      url: string;
      reasons: string[] | Reason[];
      justification: string;
    }): Promise<void>;
    function closeDocument(): Promise<void>;
  }

  namespace downloads {
    interface DownloadOptions {
      url: string;
      filename?: string;
      conflictAction?: string;
      saveAs?: boolean;
      method?: string;
      headers?: Array<{ name: string; value: string }>;
      body?: string;
    }
    function download(
      options: DownloadOptions,
      callback?: (downloadId: number) => void
    ): Promise<number>;
  }

  namespace storage {
    interface StorageArea {
      get(keys?: string | string[] | Record<string, any>): Promise<Record<string, any>>;
      set(items: Record<string, any>): Promise<void>;
      remove(keys: string | string[]): Promise<void>;
      clear(): Promise<void>;
    }
    const session: StorageArea;
    const local: StorageArea;
    const sync: StorageArea;
  }
}

declare module '@ffmpeg/ffmpeg' {
  export class FFmpeg {
    load(config?: any): Promise<void>;
    writeFile(path: string, data: any): Promise<void>;
    readFile(path: string): Promise<any>;
    deleteFile(path: string): Promise<void>;
    exec(args: string[]): Promise<number>;
    on(event: string, callback: (...args: any[]) => void): void;
    off(event: string, callback: (...args: any[]) => void): void;
    terminate(): Promise<void>;
  }
}
