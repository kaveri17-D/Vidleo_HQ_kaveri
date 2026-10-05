import { ClientCapabilities } from './types';

let cachedCapabilities: ClientCapabilities | null = null;

export function detectCapabilities(): ClientCapabilities {
  if (cachedCapabilities) {
    return cachedCapabilities;
  }

  const isBrowser = typeof window !== 'undefined';
  if (!isBrowser) {
    return {
      fsa_supported: false,
      opfs_supported: false,
      remux_supported: false,
      hls_supported: false,
    };
  }

  const fsa_supported = typeof (window as any).showSaveFilePicker === 'function';
  const opfs_supported = typeof navigator !== 'undefined' && 
                         typeof navigator.storage !== 'undefined' && 
                         typeof navigator.storage.getDirectory === 'function';
  const remux_supported = typeof ArrayBuffer !== 'undefined' && 
                          typeof DataView !== 'undefined';

  let hls_supported = false;
  if (typeof (window as any).MediaSource !== 'undefined') {
    hls_supported = (window as any).MediaSource.isTypeSupported('video/mp4; codecs="avc1.42E01E,mp4a.40.2"');
  }

  cachedCapabilities = {
    fsa_supported,
    opfs_supported,
    remux_supported,
    hls_supported,
  };

  return cachedCapabilities;
}
