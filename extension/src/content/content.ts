/**
 * Vidleo NEXUS Content Script Bridge
 * Bridges web page window.postMessage with chrome.runtime
 */

// Inject window flag into the main page world
try {
  const script = document.createElement('script');
  script.textContent = `
    window.__NEXUS_EXTENSION_INSTALLED__ = true;
    window.__NEXUS_EXTENSION_VERSION__ = "1.0.0";
    window.dispatchEvent(new CustomEvent('nexus-extension-ready', { detail: { version: '1.0.0' } }));
  `;
  (document.head || document.documentElement).appendChild(script);
  script.remove();
} catch (e) {
  console.warn('[NEXUS Content] Failed to inject window flags:', e);
}

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
    }, '*');
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
        type: `${type}_ACK`,
        messageId,
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
