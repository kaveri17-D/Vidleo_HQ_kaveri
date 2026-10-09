import { QualityAvailability, QualityOption } from './types';

function heightOf(option: QualityOption): number | undefined {
  const resolution = String(option.resolution || '');
  const resolutionMatch = resolution.match(/(?:x|×)(\d{3,4})\b/i);
  if (resolutionMatch) return Number(resolutionMatch[1]);
  const labelMatch = String(option.label || '').match(/\b(\d{3,4})p\b/i);
  return labelMatch ? Number(labelMatch[1]) : undefined;
}

function availabilityRank(value?: QualityAvailability): number {
  switch (value) {
    case 'ACTUAL_MEDIA_ACQUIRABLE': return 4;
    case 'ACTUAL_MEDIA_AVAILABLE': return 3;
    case 'METADATA_ONLY': return 2;
    case 'UNAVAILABLE': return 0;
    default: return 1;
  }
}

function bitrateOf(option: QualityOption): number {
  const match = String(option.bitrate || '').replace(/,/g, '').match(/[\d.]+/);
  return match ? Number(match[0]) : 0;
}

function preferredCandidate(a: QualityOption, b: QualityOption): QualityOption {
  const codecScore = (opt: QualityOption) => {
    const vc = String(opt.vcodec || '').toLowerCase();
    const cont = String(opt.container || '').toLowerCase();
    // Prefer H.264 / AVC1 for WhatsApp compatibility
    if (vc.includes('avc') || vc.includes('h264') || cont === 'mp4') return 2;
    // Next prefer VP9 / AV1
    if (vc.includes('vp9') || vc.includes('av01') || vc.includes('av1')) return 1;
    return 0;
  };

  const score = (option: QualityOption) => [
    availabilityRank(option.availability),
    option.isRecommended ? 1 : 0,
    codecScore(option),
    bitrateOf(option),
    String(option.id),
  ];
  const left = score(a);
  const right = score(b);
  for (let i = 0; i < left.length; i++) {
    if (left[i] === right[i]) continue;
    if (typeof left[i] === 'string' || typeof right[i] === 'string') {
      return String(left[i]) < String(right[i]) ? a : b;
    }
    return Number(left[i]) > Number(right[i]) ? a : b;
  }
  return a;
}

function displayLabel(height: number | undefined, fallback: string): string {
  if (!height) return fallback || 'Standard Video';
  if (height >= 2160) return `${height}p (4K)`;
  if (height >= 1440) return `${height}p (2K)`;
  if (height >= 1080) return `${height}p (Full HD)`;
  if (height >= 720) return `${height}p (HD)`;
  if (height === 480) return `${height}p (SD)`;
  return `${height}p`;
}

/**
 * Collapses technical source variants into one user-facing option per real
 * output height. The selected candidate remains the actual source stream;
 * variants are retained for diagnostics and future advanced selection.
 */
export function groupVideoQualityOptions(options: QualityOption[]): QualityOption[] {
  const groups = new Map<string, QualityOption[]>();
  for (const option of options) {
    const height = heightOf(option);
    const key = height ? `height:${height}` : `unknown:${option.label || option.id}`;
    const group = groups.get(key) || [];
    group.push(option);
    groups.set(key, group);
  }

  return Array.from(groups.values())
    .map((variants) => {
      const selected = variants.reduce(preferredCandidate);
      const height = heightOf(selected);
      return {
        ...selected,
        label: displayLabel(height, selected.label),
        resolution: selected.resolution || (height ? `${height}p` : undefined),
        sourceVariants: variants,
      } as QualityOption;
    })
    .sort((a, b) => (heightOf(b) || 0) - (heightOf(a) || 0) || a.label.localeCompare(b.label));
}
