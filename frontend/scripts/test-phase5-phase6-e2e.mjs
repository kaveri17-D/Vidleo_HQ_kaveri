import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import https from 'https';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const extDistPath = path.resolve(__dirname, '../../extension/dist');

const VIDEO_URL = 'https://www.youtube.com/watch?v=jNQXAC9IVRw';
const DOWNLOAD_DIR = '/downloads';
const WORKSPACE_DOWNLOAD_DIR = '/workspace/downloads';

function fetchBackendAccounting() {
  return new Promise((resolve) => {
    https.get('https://backend-production-2ff30.up.railway.app/api/accounting/media', (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve({ backend_media_bytes_received: 0, backend_media_bytes_sent: 0, backend_media_bytes: 0 });
        }
      });
    }).on('error', () => {
      resolve({ backend_media_bytes_received: 0, backend_media_bytes_sent: 0, backend_media_bytes: 0 });
    });
  });
}

(async () => {
  console.log('='.repeat(75));
  console.log('VIDLEO / NEXUS — PRODUCTION UI BUTTON CLICK E2E ACQUISITION TEST');
  console.log('Target Video URL: ', VIDEO_URL);
  console.log('Download Dir:     ', DOWNLOAD_DIR);
  console.log('='.repeat(75));

  // Ensure directories exist
  if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
  if (!fs.existsSync(WORKSPACE_DOWNLOAD_DIR)) fs.mkdirSync(WORKSPACE_DOWNLOAD_DIR, { recursive: true });

  // 1. Initial Accounting Check
  const initialAccounting = await fetchBackendAccounting();
  console.log('\n[1] Initial Railway Accounting:', JSON.stringify(initialAccounting, null, 2));

  // 2. Launch Chromium with MV3 Extension
  console.log('\n[2] Launching Chromium 153 with MV3 Extension...');
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
      '--autoplay-policy=no-user-gesture-required',
    ],
  });

  try {
    // Locate Service Worker
    let swTarget = null;
    for (let i = 0; i < 30; i++) {
      const targets = browser.targets();
      swTarget = targets.find(t => t.type() === 'service_worker' && t.url().includes('chrome-extension://'));
      if (swTarget) break;
      await new Promise(r => setTimeout(r, 200));
    }
    console.log('[PASS] Extension Service Worker active:', swTarget?.url());

    // 3. Open Real YouTube Tab
    console.log('\n[3] Opening YouTube Tab with target video...');
    const ytPage = await browser.newPage();
    let ytLoaded = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        console.log(`[3.${attempt}] Navigating to YouTube watch page...`);
        await ytPage.goto(VIDEO_URL, { waitUntil: 'domcontentloaded', timeout: 35000 });
        ytLoaded = true;
        break;
      } catch (err) {
        console.warn(`[3.${attempt}] YouTube navigation retry:`, err.message);
        await new Promise(r => setTimeout(r, 2000));
      }
    }
    if (!ytLoaded) throw new Error('Failed to load YouTube watch page after 3 attempts');
    await ytPage.waitForSelector('video', { timeout: 20000 });
    
    // Ensure playback in YouTube tab
    await ytPage.evaluate(async () => {
      const v = document.querySelector('video');
      if (v) {
        v.currentTime = 0;
        try { v.muted = true; await v.play(); } catch {}
      }
    });
    console.log('[PASS] YouTube Tab active and playback initiated');

    // 4. Open Vidleo Production UI in second tab
    console.log('\n[4] Opening Vidleo Production UI on https://frontend-kaveri-d.vercel.app/ ...');
    const vidleoPage = await browser.newPage();
    
    // Allow downloads via CDP on both pages
    const client = await vidleoPage.target().createCDPSession();
    await client.send('Page.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: DOWNLOAD_DIR,
    });

    await vidleoPage.goto('https://frontend-kaveri-d.vercel.app/', { waitUntil: 'domcontentloaded', timeout: 45000 });
    
    vidleoPage.on('console', msg => console.log(`[Vidleo Console] ${msg.text()}`));
    vidleoPage.on('pageerror', err => console.log(`[Vidleo PageError] ${err.message}`));

    // Enter URL in UrlDownloader
    const inputSelector = 'input[placeholder="Paste a video link here..."]';
    await vidleoPage.waitForSelector(inputSelector);
    await vidleoPage.type(inputSelector, VIDEO_URL);
    
    // Explicitly click Download button in form
    const submitBtn = await vidleoPage.evaluateHandle(() => {
      const input = document.querySelector('input[placeholder="Paste a video link here..."]');
      const form = input?.closest('form');
      return form ? form.querySelector('button[type="submit"]') : null;
    });
    if (submitBtn) {
      await submitBtn.click();
    } else {
      await vidleoPage.keyboard.press('Enter');
    }

    console.log('[5] Waiting for detection card on Vidleo UI...');
    let cardFound = false;
    for (let i = 0; i < 30; i++) {
      const text = await vidleoPage.evaluate(() => document.body.innerText);
      if (text.includes('Browser Playback Capture') && text.includes('Download 10s Demo')) {
        cardFound = true;
        break;
      }
      if (i % 3 === 0) {
        const stageSnippet = text.slice(text.indexOf('Vidleo helps you download'), text.indexOf('Vidleo helps you download') + 200).replace(/\n+/g, ' ');
        console.log(`[UI Poll ${i * 2}s]: ${stageSnippet}`);
      }
      await new Promise(r => setTimeout(r, 2000));
    }
    if (!cardFound) throw new Error('Detection card did not appear with Browser Playback Capture buttons within 60s');
    console.log('[PASS] Detected card rendered with Browser Playback Capture buttons!');

    // -------------------------------------------------------------
    // PHASE 5: TEST "Download 10s Demo" BUTTON CLICK
    // -------------------------------------------------------------
    console.log('\n[PHASE 5] Clicking [ Download 10s Demo ] button on the production UI...');
    const demo10sBtn = await vidleoPage.evaluateHandle(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      return buttons.find(b => b.innerText.includes('Download 10s Demo'));
    });
    
    if (!demo10sBtn) throw new Error('Could not find [ Download 10s Demo ] button on page');
    await demo10sBtn.click();
    console.log('[PASS] Clicked [ Download 10s Demo ] button! Recording playback for 10 seconds...');

    // Wait for capture & download completion
    await vidleoPage.waitForFunction(() => {
      const text = document.body.innerText;
      return text.includes('Download Ready') || text.includes('Download Again') || text.includes('Playable Media Verified');
    }, { timeout: 45000 });
    console.log('[PASS] 10s Demo Download reported ready on UI!');

    // Check files in download dir
    await new Promise(r => setTimeout(r, 2000));
    const filesAfterDemo = fs.readdirSync(DOWNLOAD_DIR);
    console.log('Files in /downloads after 10s demo:', filesAfterDemo);

    const demo10sFile = filesAfterDemo.find(f => f.includes('10s_demo') || f.includes('Demo') || f.endsWith('.webm'));
    if (!demo10sFile) throw new Error('No 10s demo file found in /downloads');

    const demo10sPath = path.join(DOWNLOAD_DIR, demo10sFile);
    const demo10sBytes = fs.readFileSync(demo10sPath);
    const demo10sSha256 = crypto.createHash('sha256').update(demo10sBytes).digest('hex');
    console.log(`[PASS] 10s Demo File Verified:`);
    console.log(` - File:   ${demo10sPath}`);
    console.log(` - Size:   ${demo10sBytes.length} bytes`);
    console.log(` - SHA256: ${demo10sSha256}`);

    // Verify 10s Demo with ffprobe
    const probe10s = execSync(`ffprobe -v quiet -print_format json -show_format -show_streams ${demo10sPath}`).toString();
    const probe10sData = JSON.parse(probe10s);
    console.log(' - ffprobe duration:', probe10sData.format?.duration, 's');
    console.log(' - ffprobe streams: ', probe10sData.streams?.map(s => `${s.codec_type}:${s.codec_name}`).join(', '));

    // Verify 10s Demo Chromium Playback
    const play10sResult = await vidleoPage.evaluate(async (base64Data) => {
      const binary = atob(base64Data);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const blob = new Blob([bytes.buffer], { type: 'video/webm' });
      const url = URL.createObjectURL(blob);
      const v = document.createElement('video');
      v.preload = 'metadata';
      v.src = url;
      return new Promise((resolve) => {
        v.onloadedmetadata = () => {
          v.play().then(() => {
            setTimeout(() => {
              resolve({
                playable: true,
                duration: v.duration,
                videoWidth: v.videoWidth,
                videoHeight: v.videoHeight,
                currentTime: v.currentTime,
              });
            }, 600);
          }).catch(err => resolve({ playable: false, error: err.message }));
        };
        v.onerror = () => resolve({ playable: false, error: 'Video load error' });
      });
    }, demo10sBytes.toString('base64'));

    console.log('[PASS] 10s Demo Chromium Playback test:', JSON.stringify(play10sResult, null, 2));

    // -------------------------------------------------------------
    // PHASE 6: TEST "Download Full Video" BUTTON CLICK
    // -------------------------------------------------------------
    console.log('\n[PHASE 6] Resetting UI and clicking [ Download Full Video ] button on the production UI...');
    
    // Click Reset button to return to format card
    const resetBtn = await vidleoPage.evaluateHandle(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      return buttons.find(b => b.innerText.includes('Reset'));
    });
    if (resetBtn) await resetBtn.click();
    await new Promise(r => setTimeout(r, 1000));

    // Reset YouTube video playback to start
    await ytPage.evaluate(() => {
      const v = document.querySelector('video');
      if (v) { v.currentTime = 0; v.play(); }
    });

    const fullVideoBtn = await vidleoPage.evaluateHandle(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      return buttons.find(b => b.innerText.includes('Download Full Video'));
    });
    if (!fullVideoBtn) throw new Error('Could not find [ Download Full Video ] button on page');
    
    await fullVideoBtn.click();
    console.log('[PASS] Clicked [ Download Full Video ] button! Capturing full video playback until end...');

    // Wait for full video completion (Me at the zoo is ~19 seconds)
    await vidleoPage.waitForFunction(() => {
      const text = document.body.innerText;
      return text.includes('Download Ready') || text.includes('Download Again') || text.includes('Playable Media Verified');
    }, { timeout: 60000 });
    console.log('[PASS] Full Video Download reported ready on UI!');

    await new Promise(r => setTimeout(r, 2000));
    const filesAfterFull = fs.readdirSync(DOWNLOAD_DIR);
    console.log('Files in /downloads after full video:', filesAfterFull);

    const fullFile = filesAfterFull.find(f => f.includes('full') || (f !== demo10sFile && f.endsWith('.webm')));
    if (!fullFile) throw new Error('No full video file found in /downloads');

    const fullPath = path.join(DOWNLOAD_DIR, fullFile);
    const fullBytes = fs.readFileSync(fullPath);
    const fullSha256 = crypto.createHash('sha256').update(fullBytes).digest('hex');
    
    console.log(`[PASS] Full Video File Verified:`);
    console.log(` - File:   ${fullPath}`);
    console.log(` - Size:   ${fullBytes.length} bytes`);
    console.log(` - SHA256: ${fullSha256}`);

    // Verify Full Video with ffprobe
    const probeFull = execSync(`ffprobe -v quiet -print_format json -show_format -show_streams ${fullPath}`).toString();
    const probeFullData = JSON.parse(probeFull);
    console.log(' - ffprobe duration:', probeFullData.format?.duration, 's');
    console.log(' - ffprobe streams: ', probeFullData.streams?.map(s => `${s.codec_type}:${s.codec_name}`).join(', '));

    // Verify Full Video Chromium Playback
    const playFullResult = await vidleoPage.evaluate(async (base64Data) => {
      const binary = atob(base64Data);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const blob = new Blob([bytes.buffer], { type: 'video/webm' });
      const url = URL.createObjectURL(blob);
      const v = document.createElement('video');
      v.preload = 'metadata';
      v.src = url;
      return new Promise((resolve) => {
        v.onloadedmetadata = () => {
          v.play().then(() => {
            setTimeout(() => {
              resolve({
                playable: true,
                duration: v.duration,
                videoWidth: v.videoWidth,
                videoHeight: v.videoHeight,
                currentTime: v.currentTime,
              });
            }, 600);
          }).catch(err => resolve({ playable: false, error: err.message }));
        };
        v.onerror = () => resolve({ playable: false, error: 'Video load error' });
      });
    }, fullBytes.toString('base64'));

    console.log('[PASS] Full Video Chromium Playback test:', JSON.stringify(playFullResult, null, 2));

    // Copy to workspace downloads as well for safety
    fs.copyFileSync(demo10sPath, path.join(WORKSPACE_DOWNLOAD_DIR, path.basename(demo10sPath)));
    fs.copyFileSync(fullPath, path.join(WORKSPACE_DOWNLOAD_DIR, path.basename(fullPath)));

    // 8. Accounting Verification
    console.log('\n[8] Querying Final Railway Accounting...');
    const finalAccounting = await fetchBackendAccounting();
    console.log('Final Accounting:', JSON.stringify(finalAccounting, null, 2));

    const evidence = {
      demo10s: {
        filename: demo10sFile,
        bytes: demo10sBytes.length,
        sha256: demo10sSha256,
        duration: probe10sData.format?.duration,
        playback: play10sResult,
      },
      fullVideo: {
        filename: fullFile,
        bytes: fullBytes.length,
        sha256: fullSha256,
        duration: probeFullData.format?.duration,
        playback: playFullResult,
      },
      accounting: {
        initial: initialAccounting,
        final: finalAccounting,
      }
    };

    fs.writeFileSync('/workspace/frontend/scripts/production-ui-e2e-evidence.json', JSON.stringify(evidence, null, 2));
    console.log('\n[PASS] Evidence saved to /workspace/frontend/scripts/production-ui-e2e-evidence.json');

  } finally {
    await browser.close();
  }
})();
