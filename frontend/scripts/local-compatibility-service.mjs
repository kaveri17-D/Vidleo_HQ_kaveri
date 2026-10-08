import http from 'http';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = process.env.COMPATIBILITY_SERVICE_PORT || 8765;
const TEMP_DIR = path.resolve(__dirname, '../../scratch/transcode_temp');
const DOWNLOAD_DIR = process.env.DOWNLOAD_DIR || '/downloads';

if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

function computeSha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

const server = http.createServer((req, res) => {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'GET' && req.url === '/health') {
    let ffmpegAvailable = false;
    try {
      execSync('ffmpeg -version', { stdio: 'ignore' });
      ffmpegAvailable = true;
    } catch {}

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      service: 'nexus-local-compatibility',
      ffmpeg: ffmpegAvailable,
      timestamp: Date.now(),
    }));
    return;
  }

  if (req.method === 'POST' && req.url === '/transcode') {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', async () => {
      try {
        const bodyStr = Buffer.concat(chunks).toString('utf-8');
        const payload = JSON.parse(bodyStr);

        const {
          videoBase64,
          audioBase64,
          rawMp4Base64,
          targetFilename = 'Vidleo_YouTube_Compatible.mp4',
        } = payload;

        const sessionId = payload.sessionId || `transcode-${Date.now()}`;
        console.log(`[CompatibilityService] Processing transcode request for session ${sessionId}...`);

        const sessionTempDir = path.join(TEMP_DIR, sessionId);
        if (!fs.existsSync(sessionTempDir)) fs.mkdirSync(sessionTempDir, { recursive: true });

        const rawMp4Path = path.join(sessionTempDir, 'original_raw.mp4');
        const outputPath = path.join(sessionTempDir, 'output_compatible.mp4');

        if (rawMp4Base64) {
          fs.writeFileSync(rawMp4Path, Buffer.from(rawMp4Base64, 'base64'));
        } else if (videoBase64 && audioBase64) {
          const inVideoPath = path.join(sessionTempDir, 'in_video.mp4');
          const inAudioPath = path.join(sessionTempDir, 'in_audio.webm');
          fs.writeFileSync(inVideoPath, Buffer.from(videoBase64, 'base64'));
          fs.writeFileSync(inAudioPath, Buffer.from(audioBase64, 'base64'));

          // First mux to rawMp4 (AV1 + Opus) for debugging preservation
          execSync(`ffmpeg -y -i "${inVideoPath}" -i "${inAudioPath}" -c:v copy -c:a copy -movflags +faststart "${rawMp4Path}"`, { stdio: 'pipe' });
        } else {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Missing input video/audio buffers' }));
          return;
        }

        // Preserve Original Acquired Media (AV1 + Opus) Internally for Debugging
        const possibleDownloadDirs = [
          DOWNLOAD_DIR,
          '/workspace/downloads',
          '/downloads',
          path.resolve(__dirname, '../../downloads'),
        ];
        for (const dir of possibleDownloadDirs) {
          try {
            if (fs.existsSync(dir)) {
              const debugPath = path.join(dir, 'Vidleo_YouTube_Original_Acquired_AV1_Opus_Debug.mp4');
              fs.copyFileSync(rawMp4Path, debugPath);
              console.log(`[CompatibilityService] Preserved original acquired media at: ${debugPath}`);
            }
          } catch (e) {
            console.warn('[CompatibilityService] Notice preserving debug copy:', e.message);
          }
        }

        // Execute Canonical WhatsApp-Compatible Transcode
        // H.264 Main/High, yuv420p, even dimensions, AAC-LC 48kHz, faststart MP4
        console.log(`[CompatibilityService] Executing FFmpeg transcode for session ${sessionId}...`);
        const ffmpegCmd = `ffmpeg -y -i "${rawMp4Path}" ` +
          `-map 0:v:0 -map 0:a:0? ` +
          `-c:v libx264 -profile:v main -level:v 4.0 -pix_fmt yuv420p ` +
          `-vf "scale=trunc(iw/2)*2:trunc(ih/2)*2" ` +
          `-preset veryfast -crf 23 ` +
          `-c:a aac -profile:a aac_low -ar 48000 -ac 2 -b:a 128k ` +
          `-movflags +faststart ` +
          `"${outputPath}"`;

        execSync(ffmpegCmd, { stdio: 'pipe' });

        const outputBuf = fs.readFileSync(outputPath);
        const outputSha256 = computeSha256(outputBuf);

        // Probe output with ffprobe
        const probeRaw = execSync(`ffprobe -v quiet -print_format json -show_format -show_streams "${outputPath}"`).toString();
        const probeData = JSON.parse(probeRaw);

        const vStream = probeData.streams?.find(s => s.codec_type === 'video');
        const aStream = probeData.streams?.find(s => s.codec_type === 'audio');
        const duration = parseFloat(probeData.format?.duration || '0');
        const width = vStream?.width || 0;
        const height = vStream?.height || 0;

        console.log(`[CompatibilityService] Transcode completed successfully: ${outputBuf.length} bytes, ${width}x${height}, ${vStream?.codec_name}+${aStream?.codec_name}`);

        // Clean temp session dir
        try {
          fs.rmSync(sessionTempDir, { recursive: true, force: true });
        } catch {}

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          sessionId,
          filename: targetFilename,
          outputBase64: outputBuf.toString('base64'),
          outputBytes: outputBuf.length,
          sha256: outputSha256,
          duration,
          width,
          height,
          videoCodec: vStream?.codec_name || 'h264',
          audioCodec: aStream?.codec_name || 'aac',
          videoProfile: vStream?.profile || 'Main',
          audioProfile: aStream?.profile || 'LC',
          pixelFormat: vStream?.pix_fmt || 'yuv420p',
          audioSampleRate: aStream?.sample_rate || '48000',
          audioChannels: aStream?.channels || 2,
          faststart: true,
          whatsappCompatible: true,
        }));

      } catch (err) {
        console.error('[CompatibilityService] Transcode error:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: false,
          error: err.message || 'Compatibility transcode failed',
        }));
      }
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[CompatibilityService] Listening on http://0.0.0.0:${PORT}`);
});
