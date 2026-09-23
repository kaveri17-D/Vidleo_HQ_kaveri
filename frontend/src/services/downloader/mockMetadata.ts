import { VideoMetadata, PlatformType, QualityOption } from './types';
import { ParsedUrlInfo } from './urlParser';

const CINEMATIC_THUMBNAILS = [
  'https://images.unsplash.com/photo-1574717024653-61fd2cf4d44d?q=80&w=1200&auto=format&fit=crop', // Cinema camera
  'https://images.unsplash.com/photo-1536440136628-849c177e76a1?q=80&w=1200&auto=format&fit=crop', // Neon film roll
  'https://images.unsplash.com/photo-1485846234645-a62644f84728?q=80&w=1200&auto=format&fit=crop', // Film slate
  'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?q=80&w=1200&auto=format&fit=crop', // Tokyo night
  'https://images.unsplash.com/photo-1509198397868-475647b2a1e5?q=80&w=1200&auto=format&fit=crop', // Minimal game
  'https://images.unsplash.com/photo-1492691527719-9d1e07e534b4?q=80&w=1200&auto=format&fit=crop', // Cinematic landscape
];

export function generateMockMetadataForUrl(parsed: ParsedUrlInfo): VideoMetadata {
  const { platform, cleanUrl, extractedId } = parsed;

  const defaultVideoQualities: QualityOption[] = [
    {
      id: 'q-4k-60',
      label: '4K 2160p (60fps Ultra)',
      resolution: '3840x2160',
      fps: 60,
      bitrate: '28 Mbps',
      fileSizeApprox: '312.4 MB',
      fileSizeBytes: 327575142,
      container: 'mp4',
      type: 'video',
      hasAudio: true,
      hdr: true,
    },
    {
      id: 'q-1080p',
      label: '1080p Full HD (Original)',
      resolution: '1920x1080',
      fps: 60,
      bitrate: '8.5 Mbps',
      fileSizeApprox: '94.2 MB',
      fileSizeBytes: 98779136,
      container: 'mp4',
      type: 'video',
      isRecommended: true,
      hasAudio: true,
    },
    {
      id: 'q-720p',
      label: '720p HD (Balanced)',
      resolution: '1280x720',
      fps: 30,
      bitrate: '3.8 Mbps',
      fileSizeApprox: '41.6 MB',
      fileSizeBytes: 43620761,
      container: 'mp4',
      type: 'video',
      hasAudio: true,
    },
    {
      id: 'q-480p',
      label: '480p SD (Compact)',
      resolution: '854x480',
      fps: 30,
      bitrate: '1.4 Mbps',
      fileSizeApprox: '18.3 MB',
      fileSizeBytes: 19188940,
      container: 'mp4',
      type: 'video',
      hasAudio: true,
    },
  ];

  const defaultAudioQualities: QualityOption[] = [
    {
      id: 'qa-320',
      label: '320 kbps (Lossless Studio MP3)',
      bitrate: '320 kbps',
      fileSizeApprox: '16.4 MB',
      fileSizeBytes: 17196646,
      container: 'mp3',
      type: 'audio',
      isRecommended: true,
      hasAudio: true,
    },
    {
      id: 'qa-256-m4a',
      label: '256 kbps (Apple AAC / M4A)',
      bitrate: '256 kbps',
      fileSizeApprox: '13.1 MB',
      fileSizeBytes: 13736345,
      container: 'm4a',
      type: 'audio',
      hasAudio: true,
    },
    {
      id: 'qa-128',
      label: '128 kbps (Standard MP3)',
      bitrate: '128 kbps',
      fileSizeApprox: '6.8 MB',
      fileSizeBytes: 7130316,
      container: 'mp3',
      type: 'audio',
      hasAudio: true,
    },
  ];

  switch (platform) {
    case 'youtube':
      return {
        id: extractedId || 'yt-78401',
        url: cleanUrl,
        canonicalUrl: `https://www.youtube.com/watch?v=${extractedId || 'dQw4w9WgXcQ'}`,
        platform: 'youtube',
        platformName: 'YouTube',
        title: 'Mastering 65mm Cinematic Color Pipeline & Sound Design in DaVinci Resolve',
        description: 'An in-depth breakdown of color grading, grain reconstruction, and spatial sound mixing for modern 4K HDR digital cinematography.',
        author: {
          name: 'CineAesthetic Studio',
          handle: '@cineaesthetic',
          avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?q=80&w=200&auto=format&fit=crop',
          verified: true,
        },
        durationSeconds: 384,
        durationFormatted: '06:24',
        thumbnailUrl: CINEMATIC_THUMBNAILS[0],
        viewsFormatted: '1.4M views',
        uploadedAtFormatted: '2 days ago',
        aspectRatio: '16:9',
        availableVideoQualities: defaultVideoQualities,
        availableAudioQualities: defaultAudioQualities,
      };

    case 'tiktok':
      return {
        id: extractedId || 'tt-9021',
        url: cleanUrl,
        canonicalUrl: cleanUrl,
        platform: 'tiktok',
        platformName: 'TikTok',
        title: 'Architectural minimalism in rain — Sound recorded on binaural mic',
        author: {
          name: 'Elena Rostova',
          handle: '@elena_visuals',
          avatarUrl: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?q=80&w=200&auto=format&fit=crop',
          verified: true,
        },
        durationSeconds: 42,
        durationFormatted: '00:42',
        thumbnailUrl: CINEMATIC_THUMBNAILS[3],
        viewsFormatted: '840K views',
        uploadedAtFormatted: '18 hours ago',
        aspectRatio: '9:16',
        availableVideoQualities: defaultVideoQualities.filter(q => q.id !== 'q-4k-60'),
        availableAudioQualities: defaultAudioQualities,
      };

    case 'instagram':
      return {
        id: extractedId || 'ig-3349',
        url: cleanUrl,
        canonicalUrl: cleanUrl,
        platform: 'instagram',
        platformName: 'Instagram Reel',
        title: 'Monochrome Film Series — 35mm Tri-X pushed two stops in Berlin',
        author: {
          name: 'Klaus Meier Lab',
          handle: '@klaus.analog',
          avatarUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?q=80&w=200&auto=format&fit=crop',
          verified: false,
        },
        durationSeconds: 28,
        durationFormatted: '00:28',
        thumbnailUrl: CINEMATIC_THUMBNAILS[1],
        viewsFormatted: '320K plays',
        uploadedAtFormatted: 'Yesterday',
        aspectRatio: '9:16',
        availableVideoQualities: defaultVideoQualities.filter(q => q.id !== 'q-4k-60'),
        availableAudioQualities: defaultAudioQualities,
      };

    case 'vimeo':
      return {
        id: extractedId || 'vm-4820',
        url: cleanUrl,
        canonicalUrl: cleanUrl,
        platform: 'vimeo',
        platformName: 'Vimeo Staff Pick',
        title: 'ECHOES OF NORDLAND — 8K Aerial Masterpiece with Orchestral Score',
        author: {
          name: 'Nordic Motion Films',
          handle: 'nordicmotion',
          avatarUrl: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?q=80&w=200&auto=format&fit=crop',
          verified: true,
        },
        durationSeconds: 512,
        durationFormatted: '08:32',
        thumbnailUrl: CINEMATIC_THUMBNAILS[5],
        viewsFormatted: '45.2K views',
        uploadedAtFormatted: '3 weeks ago',
        aspectRatio: '16:9',
        availableVideoQualities: defaultVideoQualities,
        availableAudioQualities: defaultAudioQualities,
      };

    case 'twitter':
      return {
        id: extractedId || 'x-10294',
        url: cleanUrl,
        canonicalUrl: cleanUrl,
        platform: 'twitter',
        platformName: 'X (Twitter)',
        title: 'Live capture of robotic precision arm executing camera move #Filmmaking',
        author: {
          name: 'Hardware Cinema',
          handle: '@hardwarecinema',
          avatarUrl: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?q=80&w=200&auto=format&fit=crop',
          verified: true,
        },
        durationSeconds: 19,
        durationFormatted: '00:19',
        thumbnailUrl: CINEMATIC_THUMBNAILS[2],
        viewsFormatted: '190K views',
        uploadedAtFormatted: '5 hours ago',
        aspectRatio: '16:9',
        availableVideoQualities: defaultVideoQualities.filter(q => q.id !== 'q-4k-60'),
        availableAudioQualities: defaultAudioQualities,
      };

    case 'soundcloud':
      return {
        id: 'sc-8821',
        url: cleanUrl,
        canonicalUrl: cleanUrl,
        platform: 'soundcloud',
        platformName: 'SoundCloud',
        title: 'Tape Saturation Ambient Drone Session — 432Hz Continuous Tape Loop',
        author: {
          name: 'Synapvo Acoustic',
          handle: 'synapvo-acoustic',
          avatarUrl: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?q=80&w=200&auto=format&fit=crop',
          verified: true,
        },
        durationSeconds: 640,
        durationFormatted: '10:40',
        thumbnailUrl: CINEMATIC_THUMBNAILS[4],
        viewsFormatted: '88K plays',
        uploadedAtFormatted: '5 days ago',
        aspectRatio: '1:1',
        availableVideoQualities: [],
        availableAudioQualities: defaultAudioQualities,
      };

    default:
      return {
        id: `gen-${Date.now()}`,
        url: cleanUrl,
        canonicalUrl: cleanUrl,
        platform: 'generic',
        platformName: 'Web Media Stream',
        title: 'Detected High Definition Media Stream & Spatial Audio Track',
        author: {
          name: 'Direct Media Source',
          handle: 'direct_stream',
        },
        durationSeconds: 180,
        durationFormatted: '03:00',
        thumbnailUrl: CINEMATIC_THUMBNAILS[0],
        viewsFormatted: 'Ready',
        uploadedAtFormatted: 'Recent',
        aspectRatio: '16:9',
        availableVideoQualities: defaultVideoQualities,
        availableAudioQualities: defaultAudioQualities,
      };
  }
}
