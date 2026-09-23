import { HistoryItem, UserPreferences, VideoMetadata, QualityOption, MediaFormatType } from './types';

const STORAGE_KEY_HISTORY = 'vidleo_history_user_real_v2';
const STORAGE_KEY_PREFS = 'vidleo_user_preferences_v2';

const DEFAULT_PREFERENCES: UserPreferences = {
  defaultFormat: 'video',
  preferredQuality: '1080p',
  autoAnalyzeOnPaste: true,
  theme: 'cinematic-dark',
  saveHistory: true,
  soundEffects: false,
};

// Known legacy demo titles to strictly filter out if present in browser cache
const LEGACY_MOCK_TITLES = [
  'tokyo nocturne',
  'minimalist architecture',
  'analog tape',
  'mastering 65mm',
  'fujifilm gfx 100 ii',
];

export class StorageService {
  /**
   * Retrieves user's real extraction history. Returns empty array if none exists.
   * Purges any legacy demo cache from previous sessions.
   */
  public static getHistory(): HistoryItem[] {
    if (typeof window === 'undefined') return [];
    try {
      // Purge legacy v1 demo cache if present in user browser
      if (localStorage.getItem('vidleo_download_history_v1')) {
        localStorage.removeItem('vidleo_download_history_v1');
      }

      const data = localStorage.getItem(STORAGE_KEY_HISTORY);
      if (!data) return [];
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed)) {
        // Filter out any legacy demo items by id or title
        const cleanRealItems = parsed.filter((item: HistoryItem) => {
          if (!item || !item.id || !item.title) return false;
          if (item.id.startsWith('hist-')) return false;
          const lowerTitle = item.title.toLowerCase();
          if (LEGACY_MOCK_TITLES.some(mock => lowerTitle.includes(mock))) return false;
          return true;
        });

        // Save sanitized array back if anything was filtered out
        if (cleanRealItems.length !== parsed.length) {
          localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(cleanRealItems));
        }

        return cleanRealItems.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      }
      return [];
    } catch {
      return [];
    }
  }

  /**
   * Appends a newly completed real extraction to the user's history
   */
  public static addHistoryItem(
    metadata: VideoMetadata,
    selectedQuality: QualityOption,
    format: MediaFormatType
  ): HistoryItem {
    const newItem: HistoryItem = {
      id: `vidleo-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      url: metadata.canonicalUrl || metadata.url,
      title: metadata.title,
      subtitle: metadata.description?.slice(0, 60) || `${metadata.platformName} ${format === 'video' ? 'Stream' : 'Audio'}`,
      platform: metadata.platform,
      platformName: metadata.platformName,
      thumbnailUrl: metadata.thumbnailUrl,
      durationFormatted: metadata.durationFormatted,
      qualityLabel: selectedQuality.label,
      format: format,
      container: selectedQuality.container,
      fileSizeApprox: selectedQuality.fileSizeApprox,
      createdAt: new Date().toISOString(),
      authorName: metadata.author?.name || metadata.platformName,
      authorAvatarUrl: metadata.author?.avatarUrl,
    };

    if (typeof window !== 'undefined') {
      try {
        const history = StorageService.getHistory();
        const updated = [newItem, ...history.filter(h => h.id !== newItem.id)].slice(0, 100);
        localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(updated));
        window.dispatchEvent(new CustomEvent('vidleo:history-updated'));
      } catch (e) {
        console.error('Failed to save to local storage', e);
      }
    }

    return newItem;
  }

  /**
   * Removes a single extraction record
   */
  public static removeHistoryItem(id: string): void {
    if (typeof window === 'undefined') return;
    try {
      const history = StorageService.getHistory();
      const updated = history.filter(item => item.id !== id);
      localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(updated));
      window.dispatchEvent(new CustomEvent('vidleo:history-updated'));
    } catch (e) {
      console.error('Failed to remove history item', e);
    }
  }

  /**
   * Clears all extraction history for the current user
   */
  public static clearHistory(): void {
    if (typeof window === 'undefined') return;
    try {
      localStorage.removeItem('vidleo_download_history_v1');
      localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify([]));
      window.dispatchEvent(new CustomEvent('vidleo:history-updated'));
    } catch (e) {
      console.error('Failed to clear history', e);
    }
  }

  public static getPreferences(): UserPreferences {
    if (typeof window === 'undefined') return DEFAULT_PREFERENCES;
    try {
      const data = localStorage.getItem(STORAGE_KEY_PREFS);
      if (!data) return DEFAULT_PREFERENCES;
      return { ...DEFAULT_PREFERENCES, ...JSON.parse(data) };
    } catch {
      return DEFAULT_PREFERENCES;
    }
  }

  public static savePreferences(prefs: Partial<UserPreferences>): UserPreferences {
    const current = StorageService.getPreferences();
    const updated = { ...current, ...prefs };
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(STORAGE_KEY_PREFS, JSON.stringify(updated));
      } catch (e) {
        console.error('Failed to save preferences', e);
      }
    }
    return updated;
  }
}
