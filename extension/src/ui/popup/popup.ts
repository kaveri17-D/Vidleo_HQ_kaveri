import type { 
  NexusMessage, 
  DownloadProgressPayload, 
  DownloadCompletePayload, 
  DownloadFailedPayload,
  ResolveMediaSuccessPayload 
} from '../../messaging/protocol';
import type { MediaManifest } from '../../../../frontend/src/packages/media-engine/types';

let currentManifest: MediaManifest | null = null;
let currentJobId: string | null = null;

const urlInput = document.getElementById('urlInput') as HTMLInputElement;
const resolveBtn = document.getElementById('resolveBtn') as HTMLButtonElement;
const formatGroup = document.getElementById('formatGroup') as HTMLDivElement;
const formatSelect = document.getElementById('formatSelect') as HTMLSelectElement;
const downloadBtn = document.getElementById('downloadBtn') as HTMLButtonElement;
const cancelBtn = document.getElementById('cancelBtn') as HTMLButtonElement;
const progressBox = document.getElementById('progressBox') as HTMLDivElement;
const stageLabel = document.getElementById('stageLabel') as HTMLSpanElement;
const percentLabel = document.getElementById('percentLabel') as HTMLSpanElement;
const progressFill = document.getElementById('progressFill') as HTMLDivElement;
const statusMessage = document.getElementById('statusMessage') as HTMLDivElement;
const errorBox = document.getElementById('errorBox') as HTMLDivElement;
const successBox = document.getElementById('successBox') as HTMLDivElement;

function showError(msg: string) {
  errorBox.textContent = msg;
  errorBox.style.display = 'block';
  successBox.style.display = 'none';
}

function showSuccess(msg: string) {
  successBox.textContent = msg;
  successBox.style.display = 'block';
  errorBox.style.display = 'none';
}

function clearMessages() {
  errorBox.style.display = 'none';
  successBox.style.display = 'none';
}

// Resolve media stream
resolveBtn.addEventListener('click', async () => {
  const url = urlInput.value.trim();
  if (!url) {
    showError('Please enter a valid video URL');
    return;
  }

  clearMessages();
  resolveBtn.disabled = true;
  resolveBtn.textContent = 'Resolving...';

  try {
    chrome.runtime.sendMessage(
      {
        type: 'RESOLVE_MEDIA',
        payload: { url },
      },
      (response) => {
        resolveBtn.disabled = false;
        resolveBtn.textContent = 'Resolve Stream';

        if (chrome.runtime.lastError) {
          showError(chrome.runtime.lastError.message || 'Failed to connect to background worker');
          return;
        }

        if (!response || response.type === 'RESOLVE_MEDIA_ERROR') {
          showError(response?.payload?.error || 'Failed to resolve media stream');
          return;
        }

        const data = response.payload as ResolveMediaSuccessPayload;
        currentManifest = data.manifest;
        currentJobId = data.jobId || data.manifest.job_id;

        // Populate format options
        formatSelect.innerHTML = '';
        const formats: Array<{ id: string; label: string; type: 'video' | 'audio' }> = [];

        // Check HLS streams
        if (currentManifest.media?.hls && currentManifest.media.hls.length > 0) {
          for (const s of currentManifest.media.hls) {
            formats.push({
              id: s.format_id,
              label: `HLS (${s.height ? s.height + 'p' : 'Auto'} ${s.codec || 'H.264'})`,
              type: 'video',
            });
          }
        }

        // Check progressive streams
        if (currentManifest.media?.progressive && currentManifest.media.progressive.length > 0) {
          for (const s of currentManifest.media.progressive) {
            formats.push({
              id: s.format_id,
              label: `Direct MP4 (${s.height ? s.height + 'p' : 'Unknown'} - ${(s.filesize ? (s.filesize / 1e6).toFixed(1) + 'MB' : 'Dynamic')})`,
              type: 'video',
            });
          }
        }

        // Check video streams
        if (currentManifest.media?.video && currentManifest.media.video.length > 0) {
          for (const s of currentManifest.media.video) {
            formats.push({
              id: s.format_id,
              label: `Adaptive Video (${s.height ? s.height + 'p' : s.format_id})`,
              type: 'video',
            });
          }
        }

        for (const f of formats) {
          const opt = document.createElement('option');
          opt.value = f.id;
          opt.dataset.type = f.type;
          opt.textContent = f.label;
          formatSelect.appendChild(opt);
        }

        if (formats.length > 0) {
          formatGroup.style.display = 'block';
        } else {
          showError('No downloadable streams detected in manifest');
        }
      }
    );
  } catch (err: any) {
    resolveBtn.disabled = false;
    resolveBtn.textContent = 'Resolve Stream';
    showError(err.message || 'Resolve failed');
  }
});

// Start download
downloadBtn.addEventListener('click', () => {
  if (!currentManifest || !currentJobId) {
    showError('Please resolve stream first');
    return;
  }

  const selectedOption = formatSelect.selectedOptions[0];
  const targetFormatId = selectedOption ? selectedOption.value : '';
  const targetFormatType = (selectedOption ? selectedOption.dataset.type : 'video') as 'video' | 'audio';

  clearMessages();
  downloadBtn.disabled = true;
  cancelBtn.disabled = false;
  progressBox.style.display = 'block';
  progressFill.style.width = '0%';
  percentLabel.textContent = '0%';
  stageLabel.textContent = 'Preparing';
  statusMessage.textContent = 'Dispatching to Offscreen MediaEngine...';

  chrome.runtime.sendMessage({
    type: 'START_DOWNLOAD',
    payload: {
      jobId: currentJobId,
      manifest: currentManifest,
      targetFormatId,
      targetFormatType,
      apiBaseUrl: 'http://127.0.0.1:8000',
    },
  });
});

// Cancel download
cancelBtn.addEventListener('click', () => {
  if (!currentJobId) return;
  chrome.runtime.sendMessage({
    type: 'DOWNLOAD_CANCEL',
    payload: { jobId: currentJobId },
  });
  downloadBtn.disabled = false;
  cancelBtn.disabled = true;
  statusMessage.textContent = 'Cancelled by user';
});

// Listen for progress / completion updates
chrome.runtime.onMessage.addListener((message: NexusMessage) => {
  if (!message || !message.type) return;

  if (message.type === 'DOWNLOAD_PROGRESS') {
    const p = message.payload as DownloadProgressPayload;
    if (p.jobId !== currentJobId) return;

    stageLabel.textContent = p.stage.toUpperCase();
    percentLabel.textContent = `${Math.round(p.progressPercent)}%`;
    progressFill.style.width = `${p.progressPercent}%`;

    let msg = p.message || '';
    if (p.speedFormatted && p.etaFormatted) {
      msg = `${msg} [${p.speedFormatted} | ETA: ${p.etaFormatted}]`;
    }
    statusMessage.textContent = msg;
  }

  if (message.type === 'DOWNLOAD_COMPLETE') {
    const p = message.payload as DownloadCompletePayload;
    if (p.jobId !== currentJobId) return;

    downloadBtn.disabled = false;
    cancelBtn.disabled = true;
    percentLabel.textContent = '100%';
    progressFill.style.width = '100%';
    stageLabel.textContent = 'COMPLETE';
    showSuccess(`Downloaded ${p.filename} (${(p.totalBytes / 1024 / 1024).toFixed(2)} MB)`);
  }

  if (message.type === 'DOWNLOAD_FAILED') {
    const p = message.payload as DownloadFailedPayload;
    if (p.jobId !== currentJobId) return;

    downloadBtn.disabled = false;
    cancelBtn.disabled = true;
    showError(`Error: ${p.error}`);
  }
});
