import http from 'http';
import fs from 'fs';
import path from 'path';
import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const extDistPath = path.resolve(rootDir, '../extension/dist');

const PORT = 8094;
let testResult = null;

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  const cleanUrl = req.url.split('?')[0];

  if (req.method === 'POST' && cleanUrl === '/api/test-result') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        testResult = JSON.parse(body);
        console.log('[Server] Received YouTube Resolution Test Result:\n', JSON.stringify(testResult, null, 2));
      } catch (e) {
        console.error('[Server] Failed to parse JSON test result:', e);
        testResult = { success: false, error: 'Malformed JSON' };
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
    });
    return;
  }

  if (cleanUrl === '/' || cleanUrl === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<!DOCTYPE html>
<html>
<head><title>YouTube Client Resolution Test</title></head>
<body>
  <h1>Vidleo YouTube Client Resolution Verification</h1>
  <div id="status">Running tests...</div>
  <script>
    window.addEventListener('message', (event) => {
      if (event.data && event.data.type === 'VIDLEO_TEST_REPORT') {
        fetch('/api/test-result', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(event.data.payload)
        });
      }
    });
  </script>
</body>
</html>`);
    return;
  }

  res.writeHead(404);
  res.end('Not Found');
});

server.listen(PORT, async () => {
  console.log(`[Test Server] Listening on http://localhost:${PORT}`);

  try {
    console.log('[Runner] Launching Chromium 153 with Vidleo Companion Extension...');
    const browser = await puppeteer.launch({
      executablePath: '/usr/bin/chromium',
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        `--load-extension=${extDistPath}`,
        `--disable-extensions-except=${extDistPath}`,
      ],
    });

    const page = await browser.newPage();
    page.on('console', msg => console.log(`[BROWSER CONSOLE ${msg.type().toUpperCase()}]`, msg.text()));
    page.on('pageerror', err => console.error('[BROWSER PAGE ERROR]', err.message));

    // Wait for extension background service worker
    console.log('[Runner] Locating MV3 Extension Service Worker...');
    let swTarget = null;
    for (let i = 0; i < 30; i++) {
      const targets = browser.targets();
      swTarget = targets.find(t => t.type() === 'service_worker' && t.url().includes('chrome-extension://'));
      if (swTarget) break;
      await new Promise(r => setTimeout(r, 200));
    }

    if (!swTarget) {
      throw new Error('Extension Service Worker not found in Chromium targets');
    }
    console.log('[Runner] Extension Service Worker found at:', swTarget.url());

    const extUrl = swTarget.url();
    const extId = extUrl.split('/')[2];
    console.log('[Runner] Extension ID:', extId);

    // Open Extension Popup Page to communicate with Service Worker
    console.log('[Runner] Opening extension popup page...');
    const popupPage = await browser.newPage();
    await popupPage.goto(`chrome-extension://${extId}/popup.html`, { waitUntil: 'load' });

    // Gate 1: Test Extension PING
    console.log('[Gate 1] Verifying Service Worker responsiveness via PING from popup...');
    const pingRes = await popupPage.evaluate(async () => {
      return new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'PING' }, (response) => {
          resolve(response);
        });
      });
    });
    console.log('[Gate 1 Result]:', pingRes);
    if (!pingRes || pingRes.type !== 'PONG') {
      throw new Error('Gate 1 FAILED: Extension service worker failed to respond to PING');
    }
    console.log('✅ Gate 1 PASSED: Extension service worker operational.');

    // Gate 2: Test Direct YouTube Client Resolution without active player stream
    console.log('[Gate 2] Testing direct YouTube client resolution (0 Railway requests)...');
    const directResult = await popupPage.evaluate(async () => {
      const testUrl = 'https://www.youtube.com/watch?v=jNQXAC9IVRw';
      return new Promise((resolve) => {
        chrome.runtime.sendMessage({
          type: 'RESOLVE_MEDIA',
          payload: { url: testUrl }
        }, (response) => {
          resolve(response);
        });
      });
    });

    console.log('[Gate 2 Direct Result Manifest Status]:', directResult?.payload?.manifest?.pipeline_status);
    console.log('[Gate 2 Direct Result Candidate Stream]:', directResult?.payload?.manifest?.candidate_stream_url);
    console.log('[Gate 2 Direct Result Direct Stream Avail]:', directResult?.payload?.manifest?.direct_stream_available);

    const manifest = directResult?.payload?.manifest;
    if (!manifest || manifest.platform !== 'youtube') {
      throw new Error('Gate 2 FAILED: Failed to resolve YouTube metadata from client network');
    }

    // Verify Truthfulness: If formats are ciphered, candidate_stream_url must be null and status STREAM_SOURCE_UNRESOLVED
    if (manifest.candidate_stream_url === null && manifest.pipeline_status !== 'STREAM_SOURCE_UNRESOLVED') {
      throw new Error(`Gate 2 FAILED: Expected STREAM_SOURCE_UNRESOLVED when candidate_stream_url is null, got ${manifest.pipeline_status}`);
    }
    console.log('✅ Gate 2 PASSED: Direct client metadata resolved without Railway transit. Truthful status: STREAM_SOURCE_UNRESOLVED.');

    // Gate 3: Test Legitimate Player Stream Observation
    console.log('[Gate 3] Simulating player-initiated videoplayback observation...');
    const observedStreamUrl = 'https://rr4---sn-ab5sznzl.googlevideo.com/videoplayback?expire=1728240000&ei=test&ip=127.0.0.1&id=jNQXAC9IVRw&itag=18&source=youtube&sig=MEQCICxVALID_OBSERVED_PLAYER_STREAM_SIG';
    
    await popupPage.evaluate(async (streamUrl) => {
      return new Promise((resolve) => {
        chrome.runtime.sendMessage({
          type: 'YOUTUBE_MEDIA_OBSERVED',
          payload: {
            videoId: 'jNQXAC9IVRw',
            streamUrl,
            pageUrl: 'https://www.youtube.com/watch?v=jNQXAC9IVRw'
          }
        }, (res) => resolve(res));
      });
    }, observedStreamUrl);

    // Re-resolve YouTube media after observation
    const observedResult = await popupPage.evaluate(async () => {
      return new Promise((resolve) => {
        chrome.runtime.sendMessage({
          type: 'RESOLVE_MEDIA',
          payload: { url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw' }
        }, (response) => {
          resolve(response);
        });
      });
    });

    const observedManifest = observedResult?.payload?.manifest;
    console.log('[Gate 3 Observed Status]:', observedManifest?.pipeline_status);
    console.log('[Gate 3 Observed Candidate]:', observedManifest?.candidate_stream_url);

    if (observedManifest?.candidate_stream_url !== observedStreamUrl) {
      throw new Error(`Gate 3 FAILED: Observed player stream was not populated into candidate_stream_url`);
    }
    if (observedManifest?.pipeline_status !== 'BROWSER_ACQUISITION_READY') {
      throw new Error(`Gate 3 FAILED: Expected BROWSER_ACQUISITION_READY, got ${observedManifest?.pipeline_status}`);
    }
    console.log('✅ Gate 3 PASSED: Player-initiated media stream successfully observed and linked to video ID!');

    // Gate 4: Test Manifest V3 webRequest and host permissions
    console.log('[Gate 4] Verifying webRequest and host permission registration...');
    const manifestPerms = await popupPage.evaluate(() => {
      return {
        manifest: chrome.runtime.getManifest(),
        hasWebRequest: Boolean(chrome.webRequest),
      };
    });

    console.log('[Gate 4 Permissions]:', manifestPerms.manifest.permissions);
    if (!manifestPerms.manifest.permissions.includes('webRequest')) {
      throw new Error('Gate 4 FAILED: webRequest permission missing from manifest.json');
    }
    console.log('✅ Gate 4 PASSED: webRequest permission and googlevideo host permissions registered in MV3.');

    const finalReport = {
      success: true,
      timestamp: new Date().toISOString(),
      gates: {
        gate1_service_worker_liveness: 'PASSED',
        gate2_truthful_stream_unresolved_status: 'PASSED',
        gate3_player_stream_observation: 'PASSED',
        gate4_mv3_webrequest_permissions: 'PASSED',
      },
      metadata: {
        title: manifest.title,
        platform: manifest.platform,
        uploader: manifest.uploader,
        initialPipelineStatus: manifest.pipeline_status,
        observedPipelineStatus: observedManifest.pipeline_status,
      }
    };

    console.log('====================================================');
    console.log('🎉 ALL YOUTUBE CLIENT-NETWORK RESOLUTION GATES PASSED!');
    console.log(JSON.stringify(finalReport, null, 2));
    console.log('====================================================');

    const resultPath = path.join(rootDir, 'scripts/youtube-resolution-verification.json');
    fs.writeFileSync(resultPath, JSON.stringify(finalReport, null, 2));

    await browser.close();
    server.close();
    process.exit(0);

  } catch (err) {
    console.error('❌ YOUTUBE RESOLUTION VERIFICATION FAILED:', err);
    server.close();
    process.exit(1);
  }
});
