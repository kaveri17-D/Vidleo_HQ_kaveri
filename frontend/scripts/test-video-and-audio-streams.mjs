import puppeteer from 'puppeteer-core';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const extDistPath = path.resolve(__dirname, '../../extension/dist');

const VIDEO_URL = 'https://www.youtube.com/watch?v=jNQXAC9IVRw';

console.log('='.repeat(75));
console.log('SEARCHING FOR BOTH VIDEO & AUDIO STREAMS IN UMP / CDP NETWORK');
console.log('='.repeat(75));

(async () => {
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

    await client.send('Network.enable', {
      maxResourceBufferSize: 100 * 1024 * 1024,
      maxTotalBufferSize: 200 * 1024 * 1024,
    });

    const streamsFound = [];

    client.on('Network.loadingFinished', async (p) => {
      try {
        const bodyRes = await client.send('Network.getResponseBody', { requestId: p.requestId });
        const buf = bodyRes.base64Encoded ? Buffer.from(bodyRes.body, 'base64') : Buffer.from(bodyRes.body, 'utf-8');
        if (buf.length > 5000) {
          const ftypIdx = buf.indexOf(Buffer.from('ftyp', 'ascii'));
          const webmIdx = buf.indexOf(Buffer.from('1a45dfa3', 'hex'));
          
          if (ftypIdx !== -1) {
            const mediaStart = Math.max(0, ftypIdx - 4);
            const mediaSlice = buf.slice(mediaStart);
            const tmpFile = `/tmp/stream_${p.requestId.replace(/[^a-zA-Z0-9]/g, '_')}.mp4`;
            fs.writeFileSync(tmpFile, mediaSlice);

            try {
              const probe = execSync(`ffprobe -v quiet -print_format json -show_format -show_streams ${tmpFile}`).toString();
              const parsed = JSON.parse(probe);
              const codec = parsed.streams?.[0]?.codec_name;
              const type = parsed.streams?.[0]?.codec_type;
              const dur = parsed.format?.duration;
              console.log(`[PASS STREAM FOUND] Req: ${p.requestId} | Type: ${type} | Codec: ${codec} | Dur: ${dur}s | Bytes: ${buf.length}`);
              streamsFound.push({ requestId: p.requestId, type, codec, dur, path: tmpFile, buffer: mediaSlice });
            } catch {}
          } else if (webmIdx !== -1) {
            const mediaSlice = buf.slice(webmIdx);
            const tmpFile = `/tmp/stream_${p.requestId.replace(/[^a-zA-Z0-9]/g, '_')}.webm`;
            fs.writeFileSync(tmpFile, mediaSlice);
            try {
              const probe = execSync(`ffprobe -v quiet -print_format json -show_format -show_streams ${tmpFile}`).toString();
              const parsed = JSON.parse(probe);
              const codec = parsed.streams?.[0]?.codec_name;
              const type = parsed.streams?.[0]?.codec_type;
              const dur = parsed.format?.duration;
              console.log(`[PASS WEBM STREAM FOUND] Req: ${p.requestId} | Type: ${type} | Codec: ${codec} | Dur: ${dur}s | Bytes: ${buf.length}`);
              streamsFound.push({ requestId: p.requestId, type, codec, dur, path: tmpFile, buffer: mediaSlice });
            } catch {}
          }
        }
      } catch {}
    });

    await page.goto(VIDEO_URL, { waitUntil: 'domcontentloaded', timeout: 35000 });
    await page.waitForSelector('video', { timeout: 20000 });

    await page.evaluate(async () => {
      const v = document.querySelector('video');
      if (v) { v.currentTime = 0; try { v.muted = false; await v.play(); } catch { v.muted = true; await v.play(); } }
    });

    for (let i = 0; i < 15; i++) {
      await new Promise(r => setTimeout(r, 1000));
    }

    console.log(`\nTotal streams acquired directly from active player: ${streamsFound.length}`);

    // If we have video and audio or multiple streams, let's remux them with FFmpeg:
    const videoStream = streamsFound.find(s => s.type === 'video');
    const audioStream = streamsFound.find(s => s.type === 'audio');

    console.log('Video Stream found:', Boolean(videoStream), videoStream?.codec);
    console.log('Audio Stream found:', Boolean(audioStream), audioStream?.codec);

  } finally {
    await browser.close();
  }
})();
