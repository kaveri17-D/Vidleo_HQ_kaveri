/**
 * Short-lived TTL cache for domain acquisition capability results
 * Prevents hammering blocked sources with repeated futile network requests.
 * Stored strictly in memory with no sensitive credentials or tokens.
 */

export interface CachedDomainProbe {
  domain: string;
  canDirectAcquire: boolean;
  corsAllowed: boolean;
  reason: string;
  timestamp: number;
}

export class DomainCapabilityCache {
  private static cache: Map<string, CachedDomainProbe> = new Map();
  private static readonly TTL_MS = 5 * 60 * 1000; // 5 minutes TTL

  public static get(domain: string): CachedDomainProbe | null {
    const entry = this.cache.get(domain);
    if (!entry) return null;

    if (Date.now() - entry.timestamp > this.TTL_MS) {
      this.cache.delete(domain);
      return null;
    }

    return entry;
  }

  public static set(domain: string, canDirectAcquire: boolean, corsAllowed: boolean, reason: string): void {
    this.cache.set(domain, {
      domain,
      canDirectAcquire,
      corsAllowed,
      reason,
      timestamp: Date.now(),
    });
  }

  public static clear(): void {
    this.cache.clear();
  }
}
