/**
 * NEXUS Worker SSRF & Host Validation Engine
 * 
 * Protects edge relay against SSRF, internal network probing,
 * and unauthorized destination relay.
 */

export class SSRFViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SSRFViolationError';
  }
}

// Convert IPv4 string to 32-bit unsigned integer
function ipv4ToInt(ip: string): number {
  const parts = ip.split('.').map(p => parseInt(p, 10));
  if (parts.length !== 4 || parts.some(p => isNaN(p) || p < 0 || p > 255)) {
    throw new SSRFViolationError(`Invalid IPv4 address: ${ip}`);
  }
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

// Range check helper [startInt, endInt]
function inRange(ipInt: number, cidrBase: string, prefixBits: number): boolean {
  const baseInt = ipv4ToInt(cidrBase);
  const mask = prefixBits === 0 ? 0 : (~0 << (32 - prefixBits)) >>> 0;
  return (ipInt & mask) === (baseInt & mask);
}

export function isIpBlocked(ip: string): boolean {
  const trimmed = ip.trim().toLowerCase();

  // IPv6 checks
  if (trimmed.includes(':')) {
    if (
      trimmed === '::1' ||
      trimmed === '::' ||
      trimmed.startsWith('fc') ||
      trimmed.startsWith('fd') ||
      trimmed.startsWith('fe8') ||
      trimmed.startsWith('fe9') ||
      trimmed.startsWith('fea') ||
      trimmed.startsWith('feb') ||
      trimmed.startsWith('ff')
    ) {
      return true;
    }
    return false;
  }

  // IPv4 checks
  try {
    const ipInt = ipv4ToInt(trimmed);
    const blockedRanges: [string, number][] = [
      ['0.0.0.0', 8],         // Broadcast/current
      ['10.0.0.0', 8],        // RFC 1918 Private
      ['100.64.0.0', 10],     // CGNAT
      ['127.0.0.0', 8],       // Loopback
      ['169.254.0.0', 16],    // Link-local / Cloud Metadata
      ['172.16.0.0', 12],     // RFC 1918 Private
      ['192.0.0.0', 24],      // IETF Protocol
      ['192.0.2.0', 24],      // TEST-NET-1
      ['192.168.0.0', 16],    // RFC 1918 Private
      ['198.18.0.0', 15],     // Benchmark
      ['198.51.100.0', 24],   // TEST-NET-2
      ['203.0.113.0', 24],    // TEST-NET-3
      ['224.0.0.0', 4],       // Multicast
      ['240.0.0.0', 4],       // Reserved
      ['255.255.255.255', 32] // Broadcast
    ];

    for (const [base, prefix] of blockedRanges) {
      if (inRange(ipInt, base, prefix)) {
        return true;
      }
    }
    return false;
  } catch {
    return true; // Malformed IP is blocked
  }
}

const BLOCKED_HOST_PATTERNS = [
  /^localhost$/i,
  /\.localhost$/i,
  /\.local$/i,
  /\.internal$/i,
  /^metadata\.google\.internal$/i,
  /^instance-data$/i,
  /^169\.254\.169\.254$/
];

export function validateTargetUrl(rawUrl: string, allowedHost?: string, allowLoopbackForDev: boolean = false): URL {
  if (!rawUrl || typeof rawUrl !== 'string') {
    throw new SSRFViolationError('Missing or empty target URL');
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new SSRFViolationError('Malformed URL');
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new SSRFViolationError(`Forbidden protocol: ${parsed.protocol}`);
  }

  const hostname = parsed.hostname.toLowerCase();
  if (!hostname) {
    throw new SSRFViolationError('URL hostname missing');
  }

  if (!allowLoopbackForDev) {
    // Check blocked host patterns
    for (const pattern of BLOCKED_HOST_PATTERNS) {
      if (pattern.test(hostname)) {
        throw new SSRFViolationError(`Access to host ${hostname} is forbidden`);
      }
    }

    // Check if hostname is an IP address
    if (/^(\d{1,3}\.){3}\d{1,3}$/.test(hostname) || hostname.includes(':')) {
      if (isIpBlocked(hostname)) {
        throw new SSRFViolationError(`Host IP ${hostname} is blocked by policy`);
      }
    }
  }

  // Check against authorized host in ticket
  if (allowedHost) {
    const normAllowed = allowedHost.trim().toLowerCase();
    const isExact = hostname === normAllowed;
    const isSubdomain = hostname.endsWith('.' + normAllowed);
    // Allow googlevideo.com CDN peer node redirects
    const isGoogleVideoPeer = (normAllowed.endsWith('.googlevideo.com') || normAllowed === 'googlevideo.com') && 
                              (hostname.endsWith('.googlevideo.com') || hostname === 'googlevideo.com');
    if (!isExact && !isSubdomain && !isGoogleVideoPeer) {
      throw new SSRFViolationError(
        `Host ${hostname} does not match authorized host ${allowedHost}`
      );
    }
  }

  return parsed;
}
