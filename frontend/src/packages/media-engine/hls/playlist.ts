/**
 * NEXUS Browser HLS — Master & Media Playlist Parser
 * 
 * Strict deterministic parsing of HLS specifications (RFC 8216) with
 * size limits, URL resolution, and scheme validation.
 */

import { HLSPlaylist, HLSVariant, HLSSegment, HLSKeyMetadata } from '../types';
import {
  MAX_HLS_PLAYLIST_BYTES,
  MAX_HLS_SEGMENTS,
  MAX_HLS_DURATION_SECONDS
} from './constants';

export class HLSParseError extends Error {
  public code: string;
  constructor(message: string, code: string = 'INVALID_PLAYLIST') {
    super(message);
    this.name = 'HLSParseError';
    this.code = code;
  }
}

function resolveSafeUrl(uri: string, baseUrl: string): string {
  const trimmed = uri.trim();
  if (!trimmed) {
    throw new HLSParseError('Empty URI encountered in playlist', 'INVALID_PLAYLIST');
  }

  let resolved: URL;
  try {
    resolved = new URL(trimmed, baseUrl);
  } catch (err: any) {
    throw new HLSParseError(`Malformed URI '${trimmed}': ${err.message}`, 'INVALID_PLAYLIST');
  }

  const proto = resolved.protocol.toLowerCase();
  if (proto !== 'http:' && proto !== 'https:') {
    throw new HLSParseError(`Unsafe URL scheme '${proto}' in playlist: ${resolved.href}`, 'SSRF_VIOLATION');
  }

  return resolved.toString();
}

function parseAttributeList(attrStr: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  // Regex matches key=value where value can be quoted string, hex string, or bare token
  const regex = /([A-Z0-9_-]+)=(?:"([^"]*)"|([^,]*))/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(attrStr)) !== null) {
    const key = match[1].trim();
    const val = match[2] !== undefined ? match[2] : (match[3] || '').trim();
    attrs[key] = val;
  }
  return attrs;
}

function parseHexBytes(hex: string): Uint8Array {
  const cleaned = hex.startsWith('0x') || hex.startsWith('0X') ? hex.slice(2) : hex;
  if (cleaned.length !== 32) {
    throw new HLSParseError(`Invalid IV hex string length (${cleaned.length} chars, expected 32 for 16 bytes)`, 'INVALID_PLAYLIST');
  }
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    const byteVal = parseInt(cleaned.substring(i * 2, i * 2 + 2), 16);
    if (isNaN(byteVal)) {
      throw new HLSParseError(`Invalid hex character in IV: ${cleaned}`, 'INVALID_PLAYLIST');
    }
    bytes[i] = byteVal;
  }
  return bytes;
}

export function parseHLSPlaylist(playlistText: string, baseUrl: string): HLSPlaylist {
  if (typeof playlistText !== 'string' || !playlistText.trim()) {
    throw new HLSParseError('Playlist is empty or not a string', 'INVALID_PLAYLIST');
  }

  if (playlistText.length > MAX_HLS_PLAYLIST_BYTES) {
    throw new HLSParseError(`Playlist exceeds maximum allowed size (${playlistText.length} > ${MAX_HLS_PLAYLIST_BYTES})`, 'PLAYLIST_TOO_LARGE');
  }

  const lines = playlistText.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length === 0 || lines[0] !== '#EXTM3U') {
    throw new HLSParseError('Missing #EXTM3U header at start of playlist', 'INVALID_PLAYLIST');
  }

  // Detect whether master or media playlist
  const isMaster = lines.some((l) => l.startsWith('#EXT-X-STREAM-INF'));

  if (isMaster) {
    return parseMasterPlaylist(lines, baseUrl);
  } else {
    return parseMediaPlaylist(lines, baseUrl);
  }
}

function parseMasterPlaylist(lines: string[], baseUrl: string): HLSPlaylist {
  const variants: HLSVariant[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('#EXT-X-STREAM-INF:')) {
      const attrStr = line.substring('#EXT-X-STREAM-INF:'.length);
      const attrs = parseAttributeList(attrStr);

      const bandwidth = parseInt(attrs['BANDWIDTH'] || '0', 10);
      const avgBandwidth = attrs['AVERAGE-BANDWIDTH'] ? parseInt(attrs['AVERAGE-BANDWIDTH'], 10) : undefined;
      const codecs = attrs['CODECS'];
      const audioGroup = attrs['AUDIO'];
      const videoGroup = attrs['VIDEO'];
      const frameRate = attrs['FRAME-RATE'] ? parseFloat(attrs['FRAME-RATE']) : undefined;

      let resolution: { width: number; height: number } | undefined;
      if (attrs['RESOLUTION']) {
        const [wStr, hStr] = attrs['RESOLUTION'].split('x');
        const w = parseInt(wStr, 10);
        const h = parseInt(hStr, 10);
        if (!isNaN(w) && !isNaN(h)) {
          resolution = { width: w, height: h };
        }
      }

      // Next line must be the URI
      i++;
      while (i < lines.length && lines[i].startsWith('#')) {
        i++;
      }
      if (i >= lines.length) {
        throw new HLSParseError('Unexpected end of playlist following #EXT-X-STREAM-INF', 'INVALID_PLAYLIST');
      }

      const variantUri = resolveSafeUrl(lines[i], baseUrl);
      variants.push({
        uri: variantUri,
        bandwidth,
        averageBandwidth: avgBandwidth,
        resolution,
        frameRate,
        codecs,
        audioGroup,
        videoGroup
      });
    }
  }

  if (variants.length === 0) {
    throw new HLSParseError('Master playlist contains 0 valid stream variants', 'INVALID_PLAYLIST');
  }

  return {
    type: 'master',
    endlist: true,
    variants,
    segments: []
  };
}

function parseMediaPlaylist(lines: string[], baseUrl: string): HLSPlaylist {
  let targetDuration: number | undefined;
  let mediaSequence = 0;
  let discontinuitySequence = 0;
  let endlist = false;

  let currentKey: HLSKeyMetadata | undefined;
  let currentMap: { uri: string; byteRange?: { length: number; offset: number } } | undefined;
  let pendingDiscontinuity = false;
  let pendingByteRange: { length: number; offset: number } | undefined;
  let lastByteRangeOffset = 0;

  const segments: HLSSegment[] = [];
  let totalDuration = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith('#EXT-X-TARGETDURATION:')) {
      targetDuration = parseFloat(line.substring('#EXT-X-TARGETDURATION:'.length));
    } else if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) {
      mediaSequence = parseInt(line.substring('#EXT-X-MEDIA-SEQUENCE:'.length), 10) || 0;
    } else if (line.startsWith('#EXT-X-DISCONTINUITY-SEQUENCE:')) {
      discontinuitySequence = parseInt(line.substring('#EXT-X-DISCONTINUITY-SEQUENCE:'.length), 10) || 0;
    } else if (line === '#EXT-X-DISCONTINUITY') {
      pendingDiscontinuity = true;
    } else if (line === '#EXT-X-ENDLIST') {
      endlist = true;
    } else if (line.startsWith('#EXT-X-KEY:')) {
      const attrs = parseAttributeList(line.substring('#EXT-X-KEY:'.length));
      const method = (attrs['METHOD'] || 'NONE').toUpperCase();
      if (method === 'NONE') {
        currentKey = undefined;
      } else if (method === 'AES-128') {
        const keyUri = attrs['URI'] ? resolveSafeUrl(attrs['URI'], baseUrl) : undefined;
        let ivBytes: Uint8Array | undefined;
        if (attrs['IV']) {
          ivBytes = parseHexBytes(attrs['IV']);
        }
        currentKey = {
          method: 'AES-128',
          uri: keyUri,
          iv: ivBytes,
          keyFormat: attrs['KEYFORMAT'] || 'identity'
        };
      } else {
        // Mark unsupported encryption (e.g. SAMPLE-AES)
        currentKey = {
          method: method as any,
          uri: attrs['URI'] ? resolveSafeUrl(attrs['URI'], baseUrl) : undefined
        };
      }
    } else if (line.startsWith('#EXT-X-MAP:')) {
      const attrs = parseAttributeList(line.substring('#EXT-X-MAP:'.length));
      if (attrs['URI']) {
        const mapUri = resolveSafeUrl(attrs['URI'], baseUrl);
        let br: { length: number; offset: number } | undefined;
        if (attrs['BYTERANGE']) {
          const parts = attrs['BYTERANGE'].split('@');
          const len = parseInt(parts[0], 10);
          const off = parts[1] ? parseInt(parts[1], 10) : 0;
          if (!isNaN(len)) br = { length: len, offset: off };
        }
        currentMap = { uri: mapUri, byteRange: br };
      }
    } else if (line.startsWith('#EXT-X-BYTERANGE:')) {
      const val = line.substring('#EXT-X-BYTERANGE:'.length);
      const parts = val.split('@');
      const length = parseInt(parts[0], 10);
      const offset = parts[1] !== undefined ? parseInt(parts[1], 10) : lastByteRangeOffset;
      if (!isNaN(length)) {
        pendingByteRange = { length, offset };
        lastByteRangeOffset = offset + length;
      }
    } else if (line.startsWith('#EXTINF:')) {
      const infoStr = line.substring('#EXTINF:'.length);
      const commaIdx = infoStr.indexOf(',');
      const durStr = commaIdx !== -1 ? infoStr.substring(0, commaIdx) : infoStr;
      const title = commaIdx !== -1 ? infoStr.substring(commaIdx + 1) : undefined;
      const duration = parseFloat(durStr);

      // Next non-comment line must be segment URI
      i++;
      while (i < lines.length && lines[i].startsWith('#')) {
        // In rare cases another tag might sit between EXTINF and URI
        if (lines[i].startsWith('#EXT-X-BYTERANGE:')) {
          const val = lines[i].substring('#EXT-X-BYTERANGE:'.length);
          const parts = val.split('@');
          const length = parseInt(parts[0], 10);
          const offset = parts[1] !== undefined ? parseInt(parts[1], 10) : lastByteRangeOffset;
          if (!isNaN(length)) {
            pendingByteRange = { length, offset };
            lastByteRangeOffset = offset + length;
          }
        }
        i++;
      }
      if (i >= lines.length) {
        throw new HLSParseError('Unexpected end of playlist following #EXTINF', 'INVALID_PLAYLIST');
      }

      const segmentUri = resolveSafeUrl(lines[i], baseUrl);
      const segIndex = mediaSequence + segments.length;

      segments.push({
        index: segIndex,
        uri: segmentUri,
        duration: isNaN(duration) ? 0 : duration,
        title,
        byteRange: pendingByteRange,
        discontinuity: pendingDiscontinuity,
        key: currentKey ? { ...currentKey } : undefined,
        map: currentMap ? { ...currentMap } : undefined
      });

      totalDuration += isNaN(duration) ? 0 : duration;
      pendingDiscontinuity = false;
      pendingByteRange = undefined;

      if (segments.length > MAX_HLS_SEGMENTS) {
        throw new HLSParseError(`Playlist exceeds maximum allowed segment count (${segments.length} > ${MAX_HLS_SEGMENTS})`, 'SEGMENT_LIMIT');
      }

      if (totalDuration > MAX_HLS_DURATION_SECONDS) {
        throw new HLSParseError(`Playlist exceeds maximum allowed duration (${totalDuration}s > ${MAX_HLS_DURATION_SECONDS}s)`, 'DURATION_LIMIT');
      }
    }
  }

  return {
    type: 'media',
    targetDuration,
    mediaSequence,
    discontinuitySequence,
    endlist,
    variants: [],
    segments
  };
}
