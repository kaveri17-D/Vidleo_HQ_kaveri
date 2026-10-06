/**
 * Vidleo NEXUS Content Script Bridge
 * Bridges web page window.postMessage with chrome.runtime
 */

// Safely set DOM attributes on documentElement (CSP-compliant, accessible to webpage JS)
try {
  if (document.documentElement) {
    document.documentElement.setAttribute('data-nexus-extension-installed', 'true');
    document.documentElement.setAttribute('data-nexus-extension-version', '1.0.0');
    document.documentElement.dataset.nexusExtensionInstalled = 'true';
    document.documentElement.dataset.nexusExtensionVersion = '1.0.0';
  }
  window.dispatchEvent(new CustomEvent('nexus-extension-ready', { detail: { version: '1.0.0' } }));
} catch (e) {
  console.warn('[NEXUS Content Bridge] Error setting DOM markers:', e);
}

// Proactively announce readiness via postMessage in case web page listener is active
try {
  window.postMessage({
    source: 'nexus-extension',
    type: 'PONG',
    version: '1.0.0',
    capabilities: {
      playbackCapture: true,
      captureStream: true,
      ffmpegLocal: true,
      zeroServerTransit: true,
    },
  }, '*');
} catch {}

// Listen for messages from the web page
window.addEventListener('message', (event) => {
  // Only handle messages addressed to nexus-extension
  if (!event.data || event.data.source !== 'nexus-webpage') return;

  const { type, payload, messageId } = event.data;

  if (type === 'PING') {
    window.postMessage({
      source: 'nexus-extension',
      type: 'PONG',
      messageId,
      version: '1.0.0',
      capabilities: {
        playbackCapture: true,
        captureStream: true,
        ffmpegLocal: true,
        zeroServerTransit: true,
      },
    }, '*');

    // Also wake up / verify background service worker
    try {
      chrome.runtime.sendMessage({ type: 'PING' }, () => {
        if (chrome.runtime.lastError) {
          // Worker might be waking up
        }
      });
    } catch {}
    return;
  }

  // Forward commands to the background service worker
  chrome.runtime.sendMessage({
    type,
    payload,
    timestamp: Date.now(),
  }, (response) => {
    if (chrome.runtime.lastError) {
      window.postMessage({
        source: 'nexus-extension',
        type: `${type}_ERROR`,
        messageId,
        error: chrome.runtime.lastError.message,
      }, '*');
      return;
    }

    if (response) {
      window.postMessage({
        source: 'nexus-extension',
        type: response.type || `${type}_ACK`,
        messageId,
        payload: response.payload || response,
        response,
      }, '*');
    }
  });
});

// Forward messages from extension background/offscreen back to web page
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) return;

  // Broadcast to web page
  window.postMessage({
    source: 'nexus-extension',
    ...message,
  }, '*');
});
