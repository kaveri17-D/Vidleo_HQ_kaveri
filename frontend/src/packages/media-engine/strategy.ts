import { 
  MediaManifest, 
  StrategyDecision, 
  StrategyType, 
  ClientCapabilities 
} from './types';
import { detectCapabilities } from './capability';

export function evaluateClientStrategy(
  manifest: MediaManifest,
  targetFormatId: string,
  targetFormatType: 'video' | 'audio' = 'video',
  customCapabilities?: ClientCapabilities
): StrategyDecision {
  const caps = customCapabilities || detectCapabilities();
  const targetFid = String(targetFormatId).trim();
  const isProcessDefined = typeof process !== 'undefined' && typeof process.env !== 'undefined';
  const relayDisabled = 
    (isProcessDefined && process.env.NEXT_PUBLIC_DISABLE_WORKER_RELAY === 'true') ||
    (typeof window !== 'undefined' && !!(window as any).__NEXUS_DISABLE_WORKER_RELAY);
  const hlsEnabled =
    (isProcessDefined && process.env.NEXT_PUBLIC_NEXUS_BROWSER_HLS_ENABLED === 'true') ||
    (typeof window !== 'undefined' && !(window as any).__NEXUS_BROWSER_HLS_DISABLED);

  // 1. Search in progressive streams
  const matchingProgressive = manifest.media.progressive.find(
    (p) => p.format_id === targetFid || p.id === targetFid
  );
  if (matchingProgressive) {
    const estSize = matchingProgressive.filesize || 0;
    if (matchingProgressive.relay_required) {
      if (relayDisabled && manifest.fallback.server_fallback_allowed) {
        return {
          strategy: 'SERVER_FALLBACK',
          reason: 'Worker relay disabled via feature flag; routing to server fallback',
          target_format_id: targetFid,
          progressive_stream: matchingProgressive,
          estimated_bytes: estSize,
        };
      }
      return {
        strategy: 'SIGNED_WORKER_RANGE',
        reason: 'Progressive media stream requiring signed worker range relay',
        target_format_id: targetFid,
        progressive_stream: matchingProgressive,
        ticket_required: true,
        estimated_bytes: estSize,
      };
    }
    if (matchingProgressive.range_supported && estSize > 10 * 1024 * 1024) {
      return {
        strategy: 'DIRECT_RANGE',
        reason: 'Progressive media stream with client range slicing',
        target_format_id: targetFid,
        progressive_stream: matchingProgressive,
        estimated_bytes: estSize,
      };
    }
    return {
      strategy: 'DIRECT_PROGRESSIVE',
      reason: 'Progressive media stream with direct CDN delivery',
      target_format_id: targetFid,
      progressive_stream: matchingProgressive,
      estimated_bytes: estSize,
    };
  }

  // 2. Search in audio-only request
  if (targetFormatType === 'audio') {
    const matchingAudio = manifest.media.audio.find(
      (a) => a.format_id === targetFid || a.id === targetFid
    ) || manifest.media.audio[0];

    if (matchingAudio) {
      const estSize = matchingAudio.filesize || 0;
      if (matchingAudio.relay_required) {
        if (relayDisabled && manifest.fallback.server_fallback_allowed) {
          return {
            strategy: 'SERVER_FALLBACK',
            reason: 'Worker relay disabled via feature flag; routing to server fallback',
            target_format_id: matchingAudio.format_id,
            audio_stream: matchingAudio,
            estimated_bytes: estSize,
          };
        }
        return {
          strategy: 'SIGNED_WORKER_RANGE',
          reason: 'Audio media stream requiring signed worker range relay',
          target_format_id: matchingAudio.format_id,
          audio_stream: matchingAudio,
          ticket_required: true,
          estimated_bytes: estSize,
        };
      }
      return {
        strategy: matchingAudio.range_supported ? 'DIRECT_RANGE' : 'DIRECT_PROGRESSIVE',
        reason: 'Audio-only direct media stream',
        target_format_id: matchingAudio.format_id,
        audio_stream: matchingAudio,
        estimated_bytes: estSize,
      };
    }
  }

  // 3. Search in separate video streams (Adaptive Mux)
  const matchingVideo = manifest.media.video.find(
    (v) => v.format_id === targetFid || v.id === targetFid
  );
  if (matchingVideo) {
    const matchingAudio = manifest.media.audio[0];
    if (caps.remux_supported && matchingAudio) {
      const estSize = (matchingVideo.filesize || 0) + (matchingAudio.filesize || 0);
      const requiresRelay = !!(matchingVideo.relay_required || matchingAudio.relay_required);
      if (requiresRelay && relayDisabled && manifest.fallback.server_fallback_allowed) {
        return {
          strategy: 'SERVER_FALLBACK',
          reason: 'Worker relay disabled via feature flag; routing to server fallback',
          target_format_id: targetFid,
          video_stream: matchingVideo,
          audio_stream: matchingAudio,
          estimated_bytes: estSize,
        };
      }
      return {
        strategy: requiresRelay ? 'SIGNED_WORKER_RANGE' : 'BROWSER_ADAPTIVE_MUX',
        reason: requiresRelay
          ? 'Adaptive streams requiring signed worker range relay and in-browser multiplexing'
          : 'Adaptive separate video and audio streams multiplexed in-browser',
        target_format_id: targetFid,
        video_stream: matchingVideo,
        audio_stream: matchingAudio,
        ticket_required: requiresRelay,
        estimated_bytes: estSize,
      };
    } else if (manifest.fallback.server_fallback_allowed) {
      return {
        strategy: 'SERVER_FALLBACK',
        reason: 'Client remuxing unsupported; fallback to governed server runner',
        target_format_id: targetFid,
        video_stream: matchingVideo,
        audio_stream: matchingAudio,
        estimated_bytes: matchingVideo.filesize || 0,
      };
    }
  }

  // 4. Search in HLS streams
  const hlsStreams = manifest.media.hls || [];
  const matchingHls = hlsStreams.find(
    (h) => h.format_id === targetFid || h.id === targetFid || targetFid === 'hls' || targetFid === 'm3u8'
  );
  if (matchingHls) {
    const estSize = matchingHls.filesize || 0;
    if (!hlsEnabled) {
      if (manifest.fallback.server_fallback_allowed) {
        return {
          strategy: 'SERVER_FALLBACK',
          reason: 'Browser HLS disabled via feature flag; routing to server fallback',
          target_format_id: targetFid,
          hls_stream: matchingHls,
          estimated_bytes: estSize,
        };
      }
      return {
        strategy: 'UNSUPPORTED',
        reason: 'Browser HLS disabled via feature flag and server fallback not allowed',
        target_format_id: targetFid,
        estimated_bytes: 0,
      };
    }

    if (!caps.hls_supported || !caps.remux_supported) {
      if (manifest.fallback.server_fallback_allowed) {
        return {
          strategy: 'SERVER_FALLBACK',
          reason: 'Client browser lacks HLS/remux capabilities; routing to server fallback',
          target_format_id: targetFid,
          hls_stream: matchingHls,
          estimated_bytes: estSize,
        };
      }
      return {
        strategy: 'UNSUPPORTED',
        reason: 'Client browser lacks HLS/remux capabilities',
        target_format_id: targetFid,
        estimated_bytes: 0,
      };
    }

    if (
      matchingHls.encryption &&
      matchingHls.encryption.toUpperCase() !== 'NONE' &&
      matchingHls.encryption.toUpperCase() !== 'AES-128'
    ) {
      if (manifest.fallback.server_fallback_allowed) {
        return {
          strategy: 'SERVER_FALLBACK',
          reason: `Unsupported HLS encryption (${matchingHls.encryption}); routing to server fallback`,
          target_format_id: targetFid,
          hls_stream: matchingHls,
          estimated_bytes: estSize,
        };
      }
      return {
        strategy: 'UNSUPPORTED',
        reason: `Unsupported HLS encryption (${matchingHls.encryption})`,
        target_format_id: targetFid,
        estimated_bytes: 0,
      };
    }

    const codecStr = (matchingHls.codec || '').toLowerCase();
    if (codecStr && !['h264', 'avc', 'mp4a', 'aac'].some((c) => codecStr.includes(c))) {
      if (manifest.fallback.server_fallback_allowed) {
        return {
          strategy: 'SERVER_FALLBACK',
          reason: `Unsupported HLS codec (${matchingHls.codec}); routing to server fallback`,
          target_format_id: targetFid,
          hls_stream: matchingHls,
          estimated_bytes: estSize,
        };
      }
      return {
        strategy: 'UNSUPPORTED',
        reason: `Unsupported HLS codec (${matchingHls.codec})`,
        target_format_id: targetFid,
        estimated_bytes: 0,
      };
    }

    return {
      strategy: 'BROWSER_HLS',
      reason: 'Supported HLS stream selected for in-browser demuxing and remuxing',
      target_format_id: targetFid,
      hls_stream: matchingHls,
      ticket_required: !!matchingHls.relay_required,
      estimated_bytes: estSize,
    };
  }

  // 5. Fallback check
  if (manifest.fallback.server_fallback_allowed) {
    return {
      strategy: 'SERVER_FALLBACK',
      reason: 'No direct stream candidate matched; routed to server fallback',
      target_format_id: targetFid,
      estimated_bytes: 0,
    };
  }

  return {
    strategy: 'UNSUPPORTED',
    reason: `No viable execution strategy for format ${targetFid}`,
    target_format_id: targetFid,
    estimated_bytes: 0,
  };
}
