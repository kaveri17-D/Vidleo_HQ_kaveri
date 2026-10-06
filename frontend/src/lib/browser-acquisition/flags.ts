/**
 * Feature flags and runtime kill-switch for Browser Media Acquisition
 */
import { FeatureFlags, ResourceBudget } from './types';

const DEFAULT_FLAGS: FeatureFlags = {
  browserMediaEnabled: true,
  browserYoutubeAcquisitionEnabled: true,
  browserFfmpegEnabled: true,
  browserServerFallbackEnabled: true,
};

// Conservative default resource budgets (prevent tab OOM)
const DEFAULT_BUDGET: ResourceBudget = {
  maxBrowserFileSizeBytes: 450 * 1024 * 1024, // 450 MB desktop default
  maxProcessingTimeMs: 180 * 1000,            // 3 minutes max
  maxMemoryEstimateMb: 1024,                  // 1 GB allocated heap estimate
  maxConcurrentJobs: 1,                       // 1 heavy wasm job at a time
};

export class FeatureFlagManager {
  private static flags: FeatureFlags = { ...DEFAULT_FLAGS };

  public static getFlags(): FeatureFlags {
    if (typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem('vidleo_feature_flags');
        if (stored) {
          return { ...DEFAULT_FLAGS, ...JSON.parse(stored) };
        }
      } catch {
        // Fall back to memory
      }
    }
    return { ...this.flags };
  }

  public static setFlags(updates: Partial<FeatureFlags>): void {
    this.flags = { ...this.flags, ...updates };
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('vidleo_feature_flags', JSON.stringify(this.flags));
      } catch {}
    }
  }

  public static resetDefaults(): void {
    this.flags = { ...DEFAULT_FLAGS };
    if (typeof window !== 'undefined') {
      try {
        localStorage.removeItem('vidleo_feature_flags');
      } catch {}
    }
  }

  public static getResourceBudget(isMobile: boolean = false): ResourceBudget {
    if (isMobile) {
      return {
        ...DEFAULT_BUDGET,
        maxBrowserFileSizeBytes: 150 * 1024 * 1024, // 150 MB max for mobile
        maxProcessingTimeMs: 120 * 1000,
        maxMemoryEstimateMb: 512,
      };
    }
    return { ...DEFAULT_BUDGET };
  }
}
