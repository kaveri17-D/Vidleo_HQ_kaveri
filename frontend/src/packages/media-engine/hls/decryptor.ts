/**
 * NEXUS Browser HLS — AES-128 Web Crypto Decryptor
 * 
 * Implements RFC 8216 Section 5.2 AES-128 decryption using native W3C Web Crypto.
 * Supports explicit 16-byte IV and sequence-number-derived IV.
 * Strict zero-logging of key material.
 */

import { HLSKeyMetadata } from '../types';

export class HLSDecryptError extends Error {
  public code: string;
  constructor(message: string, code: string = 'UNSUPPORTED_ENCRYPTION') {
    super(message);
    this.name = 'HLSDecryptError';
    this.code = code;
  }
}

/**
 * Derives the 16-byte IV from the media sequence number per RFC 8216 Section 5.2:
 * "The sequence number of the Media Segment MUST be used as the IV... The 32-bit
 * sequence number MUST be placed in big-endian order in the last 4 octets of a
 * 16-octet array, with the first 12 octets set to zero."
 */
export function deriveSequenceIV(sequenceNumber: number): Uint8Array {
  const iv = new Uint8Array(16);
  const view = new DataView(iv.buffer);
  // Big-endian 32-bit unsigned integer at offset 12
  view.setUint32(12, sequenceNumber, false);
  return iv;
}

export class AES128Decryptor {
  private keyCache = new Map<string, CryptoKey>();

  /**
   * Imports a raw 16-byte key into a Web Crypto CryptoKey.
   */
  public async importKey(keyBytes: Uint8Array, cacheKey?: string): Promise<CryptoKey> {
    if (!keyBytes || keyBytes.byteLength !== 16) {
      throw new HLSDecryptError(
        `Invalid AES-128 key length (${keyBytes?.byteLength || 0} bytes, expected exactly 16 bytes)`,
        'INVALID_SEGMENT'
      );
    }

    if (cacheKey && this.keyCache.has(cacheKey)) {
      return this.keyCache.get(cacheKey)!;
    }

    try {
      const cryptoKey = await crypto.subtle.importKey(
        'raw',
        keyBytes as BufferSource,
        { name: 'AES-CBC' },
        false,
        ['decrypt']
      );

      if (cacheKey) {
        this.keyCache.set(cacheKey, cryptoKey);
      }
      return cryptoKey;
    } catch (err: any) {
      throw new HLSDecryptError(`Failed to import AES-128 key: ${err.message}`, 'INVALID_SEGMENT');
    }
  }

  /**
   * Decrypts an encrypted media segment.
   */
  public async decryptSegment(
    encryptedData: Uint8Array,
    keyMetadata: HLSKeyMetadata,
    rawKeyBytes: Uint8Array,
    sequenceNumber: number
  ): Promise<Uint8Array> {
    if (keyMetadata.method === 'NONE') {
      return encryptedData;
    }

    if (keyMetadata.method !== 'AES-128') {
      throw new HLSDecryptError(
        `Unsupported HLS encryption method: '${keyMetadata.method}'. Only AES-128 is supported.`,
        'UNSUPPORTED_ENCRYPTION'
      );
    }

    // Determine IV: explicit or sequence-derived
    let iv: Uint8Array;
    if (keyMetadata.iv && keyMetadata.iv.byteLength === 16) {
      iv = keyMetadata.iv;
    } else {
      iv = deriveSequenceIV(sequenceNumber);
    }

    const cryptoKey = await this.importKey(rawKeyBytes, keyMetadata.uri);

    try {
      const decryptedBuf = await crypto.subtle.decrypt(
        {
          name: 'AES-CBC',
          iv: iv as BufferSource
        },
        cryptoKey,
        encryptedData as BufferSource
      );

      return new Uint8Array(decryptedBuf);
    } catch (err: any) {
      throw new HLSDecryptError(`AES-128 decryption failed: ${err.message}`, 'DECRYPT_FAILED');
    }
  }

  public clear(): void {
    this.keyCache.clear();
  }
}
