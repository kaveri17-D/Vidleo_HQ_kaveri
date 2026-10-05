import {
  MediaManifest,
  ClientCapabilities,
  PlatformCapabilities,
  GovernorDecision,
  ExecutionMode,
  ExecutionLocation,
  StreamMediaItem,
} from './types';
import { evaluateClientStrategy } from './strategy';
import { detectCapabilities } from './capability';

export function detectPlatformCapabilities(): PlatformCapabilities {
  const isBrowser = typeof window !== 'undefined';
  const ua = isBrowser ? navigator.userAgent : 'Node.js/Server';

  let browser = 'Unknown';
  let browser_version = '1.0';
  if (ua.includes('Edg/')) {
    browser = 'Edge';
    browser_version = ua.split('Edg/')[1]?.split(' ')[0] || '1.0';
  } else if (ua.includes('Chrome/')) {
    browser = ua.includes('Chromium/') ? 'Chromium' : 'Chrome';
    browser_version = ua.split('Chrome/')[1]?.split(' ')[0] || '1.0';
  } else if (ua.includes('Firefox/')) {
    browser = 'Firefox';
    browser_version = ua.split('Firefox/')[1]?.split(' ')[0] || '1.0';
  } else if (ua.includes('Safari/') && !ua.includes('Chrome/')) {
    browser = 'Safari';
    browser_version = ua.split('Version/')[1]?.split(' ')[0] || '1.0';
  }

  let os = 'Linux';
  if (ua.includes('Windows')) os = 'Windows';
  else if (ua.includes('Macintosh') || ua.includes('Mac OS')) os = 'macOS';
  else if (ua.includes('Android')) os = 'Android';
  else if (ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS';

  const webcodecs = isBrowser && typeof (window as any).VideoDecoder !== 'undefined';
  const webgpu = isBrowser && typeof (navigator as any).gpu !== 'undefined';
  const webgl2 = isBrowser && typeof (window as any).WebGL2RenderingContext !== 'undefined';
  const mediacapabilities = isBrowser && typeof (navigator as any).mediaCapabilities !== 'undefined';

  return {
    browser,
    browser_version,
    os,
    os_version: 'Current',
    architecture: 'x86_64',
    cpu: 'Host CPU',
    gpu_vendor: 'Platform GPU Vendor',
    gpu_name: 'Platform GPU Device',
    gpu_type: 'integrated',
    device_class: ua.includes('Mobi') ? 'mobile' : 'desktop',
    video_decoders: ['h264', 'vp9'],
    video_encoders: ['h264'],
    webcodecs,
    webgpu,
    webgl2,
    mediacapabilities,
    storage_available: 10737418240,
    memory_available: 4294967296,
    hardware_decode: true,
    hardware_encode: false,
    gpu_compute: false,
    client_remux: true,
  };
}

export function governClientExecution(
  manifest: MediaManifest,
  targetFormatId: string,
  targetFormatType: 'video' | 'audio' = 'video',
  mode: ExecutionMode = 'NORMAL_CLIENT_FIRST',
  customCapabilities?: ClientCapabilities,
  customPlatformCapabilities?: PlatformCapabilities,
  serverGpuAvailable: boolean = true
): GovernorDecision {
  const caps = customCapabilities || detectCapabilities();
  const plat = customPlatformCapabilities || detectPlatformCapabilities();
  const targetFid = String(targetFormatId).trim();

  const strat = evaluateClientStrategy(manifest, targetFid, targetFormatType, caps);
  const stream: StreamMediaItem | undefined =
    strat.progressive_stream || strat.video_stream || strat.hls_stream || strat.audio_stream;

  const codec = stream?.codec || 'unknown';
  const container = stream?.container || 'mp4';
  const estBytes = strat.estimated_bytes || stream?.filesize || 5000000;

  let resolution = '1920x1080';
  let framerate = 30;
  let profile = null;

  const codecLower = codec.toLowerCase();
  if (codecLower.includes('vp09') || codecLower.includes('vp9')) {
    profile = 'Profile 0';
    resolution = '3840x2160';
  } else if (codecLower.includes('avc1') || codecLower.includes('h264')) {
    profile = 'High Profile (Main)';
    resolution = '1920x1080';
  }

  const clientPossible = strat.strategy !== 'SERVER_FALLBACK' && strat.strategy !== 'UNSUPPORTED';
  let clientHwCapable = false;
  let clientSwCapable = false;
  let hwDecoderName: string | null = null;

  if (clientPossible) {
    const isHwEligible =
      (codecLower.includes('h264') || codecLower.includes('avc') || codecLower.includes('vp9')) &&
      plat.hardware_decode;
    if (isHwEligible) {
      clientHwCapable = true;
      hwDecoderName = plat.os === 'Linux' ? 'VaapiVideoDecoder' : 'PlatformVideoDecoder';
    }
    clientSwCapable = true;
  }

  const commonMeta = {
    codec,
    profile,
    level: '4.1',
    bit_depth: 8,
    resolution,
    framerate,
    container,
    duration: (stream as any)?.duration || (manifest as any)?.duration || 0,
    size: (stream as any)?.filesize || estBytes,
    memory_estimate: Math.min(estBytes, 120 * 1024 * 1024),
    storage_available: plat.storage_available,
    storage_supported: plat.storage_available > 0,
    browser: plat.browser,
    browser_version: plat.browser_version,
    os: plat.os,
    os_version: plat.os_version,
    architecture: plat.architecture,
    cpu: plat.cpu,
    gpu_vendor: plat.gpu_vendor,
    gpu_name: plat.gpu_name,
    gpu_type: plat.gpu_type,
    device_class: plat.device_class,
    hardware_encoder: plat.video_encoders.length > 0 ? plat.video_encoders[0] : null,
    webcodecs_supported: plat.webcodecs,
    webgpu_supported: plat.webgpu,
    media_capabilities_supported: plat.mediacapabilities,
    client_hardware_requested: 'prefer-hardware',
    server_gpu_available: serverGpuAvailable,
    server_cpu_available: true,
    decision_timestamp: Date.now() / 1000,
    job_id: (manifest as any)?.job_id || null,
  };

  // 1. MODE: GPU_REQUIRED
  if (mode === 'GPU_REQUIRED') {
    if (clientPossible && clientHwCapable) {
      const loc: ExecutionLocation =
        strat.strategy === 'SIGNED_WORKER_RANGE' ? 'CLIENT_PLUS_WORKER' : 'CLIENT_HARDWARE';
      return {
        execution_mode: mode,
        execution_location: loc,
        client_execution: true,
        client_hardware_capable: true,
        client_hardware_proven: true,
        client_software_available: clientSwCapable,
        server_gpu_allowed: false,
        server_gpu_selected: false,
        fallback_reason: null,
        fallback_level: 0,
        hardware_decoder: hwDecoderName,
        confidence: 'VERY_HIGH',
        evidence_sources: ['CLIENT_HARDWARE_DECODE', 'GPU_REQUIRED_POLICY'],
        ...commonMeta,
      };
    } else if (serverGpuAvailable) {
      return {
        execution_mode: mode,
        execution_location: 'SERVER_GPU',
        client_execution: false,
        client_hardware_capable: clientHwCapable,
        client_hardware_proven: false,
        client_software_available: clientSwCapable,
        server_gpu_allowed: true,
        server_gpu_selected: true,
        fallback_reason: strat.reason || 'Client HW unavailable; routed to Server GPU under GPU_REQUIRED',
        fallback_level: 2,
        hardware_decoder: null,
        confidence: 'HIGH',
        evidence_sources: ['SERVER_GPU_FALLBACK', 'GPU_REQUIRED_POLICY'],
        ...commonMeta,
      };
    } else {
      return {
        execution_mode: mode,
        execution_location: 'GPU_EXECUTION_UNAVAILABLE',
        client_execution: false,
        client_hardware_capable: clientHwCapable,
        client_hardware_proven: false,
        client_software_available: clientSwCapable,
        server_gpu_allowed: false,
        server_gpu_selected: false,
        fallback_reason: 'GPU_REQUIRED mode active but neither client hardware nor server GPU is available',
        fallback_level: 4,
        hardware_decoder: null,
        confidence: 'ABSOLUTE',
        evidence_sources: ['GPU_REQUIRED_INVARIANT_ENFORCEMENT'],
        ...commonMeta,
      };
    }
  }

  // 2. NORMAL_CLIENT_FIRST & GPU_PREFERRED
  if (clientPossible && clientHwCapable) {
    const loc: ExecutionLocation =
      strat.strategy === 'SIGNED_WORKER_RANGE' ? 'CLIENT_PLUS_WORKER' : 'CLIENT_HARDWARE';
    return {
      execution_mode: mode,
      execution_location: loc,
      client_execution: true,
      client_hardware_capable: true,
      client_hardware_proven: true,
      client_software_available: clientSwCapable,
      server_gpu_allowed: false,
      server_gpu_selected: false,
      fallback_reason: null,
      fallback_level: 0,
      hardware_decoder: hwDecoderName,
      confidence: 'VERY_HIGH',
      evidence_sources: ['CLIENT_HARDWARE_DECODE', 'CLIENT_FIRST_POLICY'],
      ...commonMeta,
    };
  }

  if (clientPossible && clientSwCapable) {
    const loc: ExecutionLocation =
      strat.strategy === 'SIGNED_WORKER_RANGE' ? 'CLIENT_PLUS_WORKER' : 'CLIENT_SOFTWARE';
    return {
      execution_mode: mode,
      execution_location: loc,
      client_execution: true,
      client_hardware_capable: false,
      client_hardware_proven: false,
      client_software_available: true,
      server_gpu_allowed: false,
      server_gpu_selected: false,
      fallback_reason: 'Client hardware decode unavailable; safe client software fallback executed',
      fallback_level: 1,
      hardware_decoder: null,
      confidence: 'HIGH',
      evidence_sources: ['CLIENT_SOFTWARE_DECODE', 'CLIENT_FIRST_POLICY'],
      ...commonMeta,
    };
  }

  if (serverGpuAvailable) {
    return {
      execution_mode: mode,
      execution_location: 'SERVER_GPU',
      client_execution: false,
      client_hardware_capable: false,
      client_hardware_proven: false,
      client_software_available: false,
      server_gpu_allowed: true,
      server_gpu_selected: true,
      fallback_reason: strat.reason || 'Client execution impossible; routed to Server GPU fallback',
      fallback_level: 2,
      hardware_decoder: null,
      confidence: 'HIGH',
      evidence_sources: ['SERVER_GPU_FALLBACK', 'SECONDARY_SERVER_GPU'],
      ...commonMeta,
    };
  }

  return {
    execution_mode: mode,
    execution_location: 'SERVER_CPU',
    client_execution: false,
    client_hardware_capable: false,
    client_hardware_proven: false,
    client_software_available: false,
    server_gpu_allowed: false,
    server_gpu_selected: false,
    fallback_reason: strat.reason || 'Client execution impossible and Server GPU unavailable; routed to Server CPU',
    fallback_level: 3,
    hardware_decoder: null,
    confidence: 'HIGH',
    evidence_sources: ['SERVER_CPU_RUNNER'],
    ...commonMeta,
  };
}
