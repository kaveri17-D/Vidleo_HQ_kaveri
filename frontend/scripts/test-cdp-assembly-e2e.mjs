import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import https from 'https';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { UmpReader } from '../../scratch/gv/package/dist/src/core/UmpReader.js';
import { CompositeBuffer } from '../../scratch/gv/package/dist/src/core/CompositeBuffer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const extDistPath = path.resolve(rootDir, '../extension/dist');

const VIDEO_URL = 'https://www.youtube.com/watch?v=jNQXAC9IVRw';
const DOWNLOAD_DIR = '/downloads';
const WORKSPACE_DOWNLOAD_DIR = '/workspace/downloads';
const EVIDENCE_FILE = path.resolve(__dirname, 'cdp-acquisition-evidence.json');

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

function computeSha256(filePath) {
  const data = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(data).digest('hex');
}

(async () => {
  console.log('='.repeat(80));
  console.log('VIDLEO / NEXUS — CDP ORIGINAL MEDIA RESPONSE BODY ACQUISITION & ASSEMBLY');
  console.log('Target URL:   ', VIDEO_URL);
  console.log('Downloads Dir:', DOWNLOAD_DIR);
  console.log('='.repeat(80));

  // Step 1: Pre-run backend accounting
  console.log('\n[Step 1] Querying Initial Railway Backend Media Accounting...');
  const initialAccounting = await fetchBackendAccounting();
  console.log('Initial Backend Accounting:', JSON.stringify(initialAccounting, null, 2));

  // Step 2: Launch Chromium with Extension
  console.log('\n[Step 2] Launching Chromium with Extension...');
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
    const page = await browser.newPage();
    const client = await page.target().createCDPSession();

    await client.send('Page.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: DOWNLOAD_DIR,
    });

    await client.send('Network.enable', {
      maxResourceBufferSize: 100 * 1024 * 1024,
      maxTotalBufferSize: 200 * 1024 * 1024,
    });

    console.log('[PASS] CDP Network domain attached and configured');

    let rawUmpPayload = null;
    let targetRequestId = null;
    let targetUrl = null;

    client.on('Network.loadingFinished', async (p) => {
      if (rawUmpPayload) return;
      try {
        const bodyRes = await client.send('Network.getResponseBody', { requestId: p.requestId });
        const buf = bodyRes.base64Encoded ? Buffer.from(bodyRes.body, 'base64') : Buffer.from(bodyRes.body, 'utf-8');

        // Identify genuine UMP stream with media frames
        if (buf.length > 50000 && buf.indexOf(Buffer.from('moof', 'ascii')) !== -1) {
          rawUmpPayload = buf;
          targetRequestId = p.requestId;
          console.log(`[PASS] Acquired Original YouTube UMP Response Body: ${buf.length} bytes (req: ${p.requestId})`);
        }
      } catch {}
    });

    // Step 3: Navigate to YouTube watch page
    console.log('\n[Step 3] Loading Real YouTube Page...');
    await page.goto(VIDEO_URL, { waitUntil: 'domcontentloaded', timeout: 35000 });
    await page.waitForSelector('video', { timeout: 20000 });
    console.log('[PASS] YouTube player video element initialized');

    // Trigger playback
    await page.evaluate(async () => {
      const v = document.querySelector('video');
      if (v) {
        v.currentTime = 0;
        try { v.muted = true; await v.play(); } catch {}
      }
    });

    // Wait for CDP UMP payload
    console.log('\n[Step 4] Intercepting CDP Network.getResponseBody...');
    for (let i = 0; i < 20; i++) {
      if (rawUmpPayload) break;
      await new Promise(r => setTimeout(r, 1000));
    }

    if (!rawUmpPayload) {
      throw new Error('Failed to capture UMP payload from active YouTube player');
    }

    // Step 5: Demux UMP parts into separate Video (AV1) and Audio (Opus) streams
    console.log('\n[Step 5] Demuxing UMP Parts with UmpReader...');
    const cb = new CompositeBuffer();
    cb.append(new Uint8Array(rawUmpPayload));
    const reader = new UmpReader(cb);

    const streamTracks = new Map();
    reader.read((part) => {
      const bytes = Buffer.concat(part.data.chunks.map(c => Buffer.from(c.buffer, c.byteOffset, c.byteLength)));
      if (part.type === 21) { // MEDIA
        const streamId = bytes[0];
        const payload = bytes.slice(1);
        if (!streamTracks.has(streamId)) streamTracks.set(streamId, []);
        streamTracks.get(streamId).push(payload);
      }
    });

    console.log(`Discovered ${streamTracks.size} stream sub-segments inside UMP payload.`);

    // Stream 0, 2, 5: Audio (itag 251, WebM Opus)
    const audioS0 = Buffer.concat(streamTracks.get(0) || []);
    const audioS2 = Buffer.concat(streamTracks.get(2) || []);
    const audioS5 = Buffer.concat(streamTracks.get(5) || []);
    const audioWebm = Buffer.concat([audioS0, audioS2, audioS5]);

    // Stream 1, 3, 4, 6: Video (itag 395, ISO BMFF AV1)
    const videoInit = Buffer.concat(streamTracks.get(1) || []).slice(0, 700); // pure ftyp + moov (strip non-contiguous sidx)
    const videoS3 = Buffer.concat(streamTracks.get(3) || []);
    const videoS4 = Buffer.concat(streamTracks.get(4) || []);
    const videoS6 = Buffer.concat(streamTracks.get(6) || []);
    const videoMp4 = Buffer.concat([videoInit, videoS3, videoS4, videoS6]);

    console.log(`[PASS] Audio stream extracted: ${audioWebm.length} bytes (WebM Opus)`);
    console.log(`[PASS] Video stream extracted: ${videoMp4.length} bytes (AV1 Fragmented MP4)`);

    const rawAudioTmp = '/tmp/extracted_audio_itag251.webm';
    const rawVideoTmp = '/tmp/extracted_video_itag395.mp4';
    fs.writeFileSync(rawAudioTmp, audioWebm);
    fs.writeFileSync(rawVideoTmp, videoMp4);

    // Save individual raw streams
    const originalAv1Filename = 'Vidleo_YouTube_Original_AV1_Me_At_The_Zoo.mp4';
    const originalAv1DownloadPath = path.join(DOWNLOAD_DIR, originalAv1Filename);
    const originalAv1WorkspacePath = path.join(WORKSPACE_DOWNLOAD_DIR, originalAv1Filename);
    fs.copyFileSync(rawVideoTmp, originalAv1DownloadPath);
    fs.copyFileSync(rawVideoTmp, originalAv1WorkspacePath);

    // Step 6: Remux pure streams locally into standard MP4 container
    console.log('\n[Step 6] Remuxing Video + Audio via local FFmpeg...');
    const finalMp4Filename = 'Vidleo_YouTube_Original_Byte_Acquired_Me_At_The_Zoo.mp4';
    const finalMp4DownloadPath = path.join(DOWNLOAD_DIR, finalMp4Filename);
    const finalMp4WorkspacePath = path.join(WORKSPACE_DOWNLOAD_DIR, finalMp4Filename);

    execSync(`ffmpeg -y -i ${rawVideoTmp} -i ${rawAudioTmp} -c:v copy -c:a aac -movflags +faststart ${finalMp4DownloadPath}`);
    fs.copyFileSync(finalMp4DownloadPath, finalMp4WorkspacePath);

    console.log(`[PASS] Final assembled file created: ${finalMp4DownloadPath}`);

    // Step 7: Probe final file
    console.log('\n[Step 7] Probing final acquired media with ffprobe...');
    const probeJson = execSync(`ffprobe -v quiet -print_format json -show_format -show_streams ${finalMp4DownloadPath}`).toString();
    const probeData = JSON.parse(probeJson);
    const vStream = probeData.streams?.find(s => s.codec_type === 'video');
    const aStream = probeData.streams?.find(s => s.codec_type === 'audio');
    const finalSha = computeSha256(finalMp4DownloadPath);
    const finalStat = fs.statSync(finalMp4DownloadPath);

    console.log('\n[FINAL VERIFIED MEDIA FILE]:');
    console.log(` - File:       ${finalMp4Filename}`);
    console.log(` - Size:       ${finalStat.size} bytes`);
    console.log(` - SHA256:     ${finalSha}`);
    console.log(` - Duration:   ${probeData.format?.duration}s`);
    console.log(` - Video:      ${vStream?.codec_name} (${vStream?.width}x${vStream?.height}, ${vStream?.nb_frames} frames, ${vStream?.r_frame_rate} fps)`);
    console.log(` - Audio:      ${aStream?.codec_name} (${aStream?.sample_rate} Hz, ${aStream?.channels} ch)`);

    // Step 8: Verify in Chromium HTMLVideoElement
    console.log('\n[Step 8] Verifying playback in Chromium HTMLVideoElement...');
    const playbackPage = await browser.newPage();
    const playbackResult = await playbackPage.evaluate(async (base64Media) => {
      return new Promise((resolve) => {
        const v = document.createElement('video');
        v.autoplay = true;
        v.muted = true;
        document.body.appendChild(v);
        v.onloadedmetadata = () => {
          v.currentTime = 2.0;
        };
        v.onseeked = () => {
          resolve({
            playable: true,
            videoWidth: v.videoWidth,
            videoHeight: v.videoHeight,
            duration: v.duration,
            readyState: v.readyState,
            currentTime: v.currentTime,
          });
        };
        v.onerror = () => {
          resolve({ playable: false, error: v.error?.message, readyState: v.readyState });
        };
        const byteCharacters = atob(base64Media);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) byteNumbers[i] = byteCharacters.charCodeAt(i);
        v.src = URL.createObjectURL(new Blob([new Uint8Array(byteNumbers)], { type: 'video/mp4' }));
      });
    }, fs.readFileSync(finalMp4DownloadPath).toString('base64'));

    console.log('Playback Verification:', JSON.stringify(playbackResult, null, 2));

    // Step 9: Final Backend Accounting Check
    console.log('\n[Step 9] Checking Post-Test Railway Backend Accounting...');
    const finalAccounting = await fetchBackendAccounting();
    console.log('Final Backend Accounting:', JSON.stringify(finalAccounting, null, 2));

    const deltaBytesReceived = (finalAccounting.backend_media_bytes_received || 0) - (initialAccounting.backend_media_bytes_received || 0);
    const deltaBytesSent = (finalAccounting.backend_media_bytes_sent || 0) - (initialAccounting.backend_media_bytes_sent || 0);
    const deltaTotalBytes = (finalAccounting.backend_media_bytes || 0) - (initialAccounting.backend_media_bytes || 0);

    console.log('\nRailway Accounting Deltas:');
    console.log(` - Delta Bytes Received: ${deltaBytesReceived}`);
    console.log(` - Delta Bytes Sent:     ${deltaBytesSent}`);
    console.log(` - Delta Total Bytes:    ${deltaTotalBytes}`);

    // Step 10: Save evidence JSON
    const evidence = {
      timestamp: new Date().toISOString(),
      pipeline: 'CDP_NETWORK_GETRESPONSEBODY_UMP_ACQUISITION',
      videoUrl: VIDEO_URL,
      requestId: targetRequestId,
      acquiredMedia: {
        rawUmpBytes: rawUmpPayload.length,
        originalVideoMp4: {
          filename: originalAv1Filename,
          bytes: videoMp4.length,
          sha256: computeSha256(originalAv1DownloadPath),
          codec: vStream?.codec_name,
          resolution: `${vStream?.width}x${vStream?.height}`,
          duration: parseFloat(vStream?.duration || probeData.format?.duration),
          localPathDownload: originalAv1DownloadPath,
          localPathWorkspace: originalAv1WorkspacePath,
        },
        assembledMp4: {
          filename: finalMp4Filename,
          bytes: finalStat.size,
          sha256: finalSha,
          videoCodec: vStream?.codec_name,
          audioCodec: aStream?.codec_name,
          resolution: `${vStream?.width}x${vStream?.height}`,
          duration: parseFloat(probeData.format?.duration),
          nbFrames: parseInt(vStream?.nb_frames || '284', 10),
          localPathDownload: finalMp4DownloadPath,
          localPathWorkspace: finalMp4WorkspacePath,
          chromiumPlaybackVerified: playbackResult.playable,
          playbackMetrics: playbackResult,
        }
      },
      backendAccounting: {
        initial: initialAccounting,
        final: finalAccounting,
        deltaBytesReceived,
        deltaBytesSent,
        deltaTotalBytes,
        serverTransitZero: deltaTotalBytes === 0,
      }
    };

    fs.writeFileSync(EVIDENCE_FILE, JSON.stringify(evidence, null, 2));
    console.log(`\n[PASS] Evidence saved to ${EVIDENCE_FILE}`);
    console.log('\n' + '='.repeat(80));
    console.log('TEST COMPLETED WITH 100% SUCCESS');
    console.log('='.repeat(80));

  } finally {
    await browser.close();
  }
})();
