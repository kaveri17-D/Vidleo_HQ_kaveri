import { PlatformType } from './types';

export interface ParsedUrlInfo {
  isValid: boolean;
  platform: PlatformType;
  platformName: string;
  cleanUrl: string;
  extractedId?: string;
  error?: string;
}

export function parseAndValidateVideoUrl(rawUrl: string): ParsedUrlInfo {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return {
      isValid: false,
      platform: 'generic',
      platformName: 'Unknown',
      cleanUrl: '',
      error: 'Please enter a video URL',
    };
  }

  // Prepend https:// if missing
  let normalizedUrl = trimmed;
  if (!/^https?:\/\//i.test(normalizedUrl)) {
    normalizedUrl = `https://${normalizedUrl}`;
  }

  let urlObj: URL;
  try {
    urlObj = new URL(normalizedUrl);
  } catch {
    return {
      isValid: false,
      platform: 'generic',
      platformName: 'Invalid URL',
      cleanUrl: trimmed,
      error: 'Please enter a valid web URL (e.g. https://youtube.com/...)',
    };
  }

  const hostname = urlObj.hostname.toLowerCase().replace(/^www\./, '');
  const pathname = urlObj.pathname;

  // 1. YouTube
  if (
    hostname === 'youtube.com' ||
    hostname === 'm.youtube.com' ||
    hostname === 'youtu.be' ||
    hostname === 'music.youtube.com'
  ) {
    let videoId: string | undefined;
    if (hostname === 'youtu.be') {
      videoId = pathname.slice(1).split('?')[0];
    } else if (pathname.startsWith('/shorts/')) {
      videoId = pathname.replace('/shorts/', '').split('/')[0];
    } else if (pathname.startsWith('/watch')) {
      videoId = urlObj.searchParams.get('v') || undefined;
    } else if (pathname.startsWith('/embed/')) {
      videoId = pathname.replace('/embed/', '').split('/')[0];
    }

    return {
      isValid: true,
      platform: 'youtube',
      platformName: 'YouTube',
      cleanUrl: normalizedUrl,
      extractedId: videoId,
    };
  }

  // 2. TikTok
  if (
    hostname === 'tiktok.com' ||
    hostname === 'm.tiktok.com' ||
    hostname === 'vm.tiktok.com' ||
    hostname === 'vt.tiktok.com'
  ) {
    const videoIdMatch = pathname.match(/\/video\/(\d+)/);
    return {
      isValid: true,
      platform: 'tiktok',
      platformName: 'TikTok',
      cleanUrl: normalizedUrl,
      extractedId: videoIdMatch ? videoIdMatch[1] : undefined,
    };
  }

  // 3. Instagram
  if (hostname === 'instagram.com' || hostname === 'instagr.am') {
    const match = pathname.match(/\/(reel|p|tv)\/([A-Za-z0-9_-]+)/);
    return {
      isValid: true,
      platform: 'instagram',
      platformName: 'Instagram',
      cleanUrl: normalizedUrl,
      extractedId: match ? match[2] : undefined,
    };
  }

  // 4. Vimeo
  if (hostname === 'vimeo.com' || hostname === 'player.vimeo.com') {
    const idMatch = pathname.match(/\/(\d+)/);
    return {
      isValid: true,
      platform: 'vimeo',
      platformName: 'Vimeo',
      cleanUrl: normalizedUrl,
      extractedId: idMatch ? idMatch[1] : undefined,
    };
  }

  // 5. X / Twitter
  if (
    hostname === 'twitter.com' ||
    hostname === 'x.com' ||
    hostname === 'mobile.twitter.com' ||
    hostname === 'fxtwitter.com' ||
    hostname === 'vxtwitter.com'
  ) {
    const statusMatch = pathname.match(/\/status\/(\d+)/);
    return {
      isValid: true,
      platform: 'twitter',
      platformName: 'X (Twitter)',
      cleanUrl: normalizedUrl,
      extractedId: statusMatch ? statusMatch[1] : undefined,
    };
  }

  // 6. Reddit
  if (hostname === 'reddit.com' || hostname === 'v.redd.it' || hostname === 'old.reddit.com') {
    return {
      isValid: true,
      platform: 'reddit',
      platformName: 'Reddit',
      cleanUrl: normalizedUrl,
    };
  }

  // 7. Pinterest
  if (hostname === 'pinterest.com' || hostname === 'pin.it') {
    return {
      isValid: true,
      platform: 'pinterest',
      platformName: 'Pinterest',
      cleanUrl: normalizedUrl,
    };
  }

  // 8. SoundCloud
  if (hostname === 'soundcloud.com' || hostname === 'm.soundcloud.com') {
    return {
      isValid: true,
      platform: 'soundcloud',
      platformName: 'SoundCloud',
      cleanUrl: normalizedUrl,
    };
  }

  // 9. Generic direct video link or other supported site
  const isDirectMedia = /\.(mp4|webm|mkv|mov|mp3|m4a|flv)(\?|$)/i.test(pathname);
  return {
    isValid: true,
    platform: 'generic',
    platformName: isDirectMedia ? 'Direct Media' : 'Web Video Stream',
    cleanUrl: normalizedUrl,
  };
}
