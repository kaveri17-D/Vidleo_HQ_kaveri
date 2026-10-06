// extension/src/ui/popup/popup.ts
var currentManifest = null;
var currentJobId = null;
var urlInput = document.getElementById("urlInput");
var resolveBtn = document.getElementById("resolveBtn");
var formatGroup = document.getElementById("formatGroup");
var formatSelect = document.getElementById("formatSelect");
var downloadBtn = document.getElementById("downloadBtn");
var cancelBtn = document.getElementById("cancelBtn");
var progressBox = document.getElementById("progressBox");
var stageLabel = document.getElementById("stageLabel");
var percentLabel = document.getElementById("percentLabel");
var progressFill = document.getElementById("progressFill");
var statusMessage = document.getElementById("statusMessage");
var errorBox = document.getElementById("errorBox");
var successBox = document.getElementById("successBox");
function showError(msg) {
  errorBox.textContent = msg;
  errorBox.style.display = "block";
  successBox.style.display = "none";
}
function showSuccess(msg) {
  successBox.textContent = msg;
  successBox.style.display = "block";
  errorBox.style.display = "none";
}
function clearMessages() {
  errorBox.style.display = "none";
  successBox.style.display = "none";
}
resolveBtn.addEventListener("click", async () => {
  const url = urlInput.value.trim();
  if (!url) {
    showError("Please enter a valid video URL");
    return;
  }
  clearMessages();
  resolveBtn.disabled = true;
  resolveBtn.textContent = "Resolving...";
  try {
    chrome.runtime.sendMessage(
      {
        type: "RESOLVE_MEDIA",
        payload: { url }
      },
      (response) => {
        resolveBtn.disabled = false;
        resolveBtn.textContent = "Resolve Stream";
        if (chrome.runtime.lastError) {
          showError(chrome.runtime.lastError.message || "Failed to connect to background worker");
          return;
        }
        if (!response || response.type === "RESOLVE_MEDIA_ERROR") {
          showError(response?.payload?.error || "Failed to resolve media stream");
          return;
        }
        const data = response.payload;
        currentManifest = data.manifest;
        currentJobId = data.jobId || data.manifest.job_id;
        formatSelect.innerHTML = "";
        const formats = [];
        if (currentManifest.media?.hls && currentManifest.media.hls.length > 0) {
          for (const s of currentManifest.media.hls) {
            formats.push({
              id: s.format_id,
              label: `HLS (${s.height ? s.height + "p" : "Auto"} ${s.codec || "H.264"})`,
              type: "video"
            });
          }
        }
        if (currentManifest.media?.progressive && currentManifest.media.progressive.length > 0) {
          for (const s of currentManifest.media.progressive) {
            formats.push({
              id: s.format_id,
              label: `Direct MP4 (${s.height ? s.height + "p" : "Unknown"} - ${s.filesize ? (s.filesize / 1e6).toFixed(1) + "MB" : "Dynamic"})`,
              type: "video"
            });
          }
        }
        if (currentManifest.media?.video && currentManifest.media.video.length > 0) {
          for (const s of currentManifest.media.video) {
            formats.push({
              id: s.format_id,
              label: `Adaptive Video (${s.height ? s.height + "p" : s.format_id})`,
              type: "video"
            });
          }
        }
        for (const f of formats) {
          const opt = document.createElement("option");
          opt.value = f.id;
          opt.dataset.type = f.type;
          opt.textContent = f.label;
          formatSelect.appendChild(opt);
        }
        if (formats.length > 0) {
          formatGroup.style.display = "block";
        } else {
          showError("No downloadable streams detected in manifest");
        }
      }
    );
  } catch (err) {
    resolveBtn.disabled = false;
    resolveBtn.textContent = "Resolve Stream";
    showError(err.message || "Resolve failed");
  }
});
downloadBtn.addEventListener("click", () => {
  if (!currentManifest || !currentJobId) {
    showError("Please resolve stream first");
    return;
  }
  const selectedOption = formatSelect.selectedOptions[0];
  const targetFormatId = selectedOption ? selectedOption.value : "";
  const targetFormatType = selectedOption ? selectedOption.dataset.type : "video";
  clearMessages();
  downloadBtn.disabled = true;
  cancelBtn.disabled = false;
  progressBox.style.display = "block";
  progressFill.style.width = "0%";
  percentLabel.textContent = "0%";
  stageLabel.textContent = "Preparing";
  statusMessage.textContent = "Dispatching to Offscreen MediaEngine...";
  chrome.runtime.sendMessage({
    type: "START_DOWNLOAD",
    payload: {
      jobId: currentJobId,
      manifest: currentManifest,
      targetFormatId,
      targetFormatType,
      apiBaseUrl: "http://127.0.0.1:8000"
    }
  });
});
cancelBtn.addEventListener("click", () => {
  if (!currentJobId) return;
  chrome.runtime.sendMessage({
    type: "DOWNLOAD_CANCEL",
    payload: { jobId: currentJobId }
  });
  downloadBtn.disabled = false;
  cancelBtn.disabled = true;
  statusMessage.textContent = "Cancelled by user";
});
chrome.runtime.onMessage.addListener((message) => {
  if (!message || !message.type) return;
  if (message.type === "DOWNLOAD_PROGRESS") {
    const p = message.payload;
    if (p.jobId !== currentJobId) return;
    stageLabel.textContent = p.stage.toUpperCase();
    percentLabel.textContent = `${Math.round(p.progressPercent)}%`;
    progressFill.style.width = `${p.progressPercent}%`;
    let msg = p.message || "";
    if (p.speedFormatted && p.etaFormatted) {
      msg = `${msg} [${p.speedFormatted} | ETA: ${p.etaFormatted}]`;
    }
    statusMessage.textContent = msg;
  }
  if (message.type === "DOWNLOAD_COMPLETE") {
    const p = message.payload;
    if (p.jobId !== currentJobId) return;
    downloadBtn.disabled = false;
    cancelBtn.disabled = true;
    percentLabel.textContent = "100%";
    progressFill.style.width = "100%";
    stageLabel.textContent = "COMPLETE";
    showSuccess(`Downloaded ${p.filename} (${(p.totalBytes / 1024 / 1024).toFixed(2)} MB)`);
  }
  if (message.type === "DOWNLOAD_FAILED") {
    const p = message.payload;
    if (p.jobId !== currentJobId) return;
    downloadBtn.disabled = false;
    cancelBtn.disabled = true;
    showError(`Error: ${p.error}`);
  }
});
//# sourceMappingURL=popup.js.map
