import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Target file from argv or standard location
const targetFile = process.argv[2] || path.resolve(__dirname, '../../downloads/Vidleo_YouTube_Me_at_the_zoo.mp4');

console.log('='.repeat(80));
console.log('VIDLEO / NEXUS — CANONICAL WHATSAPP COMPATIBILITY AUDIT');
console.log('Target Media File: ', targetFile);
console.log('='.repeat(80));

function checkAtomOrder(filePath) {
  try {
    const buf = fs.readFileSync(filePath);
    let offset = 0;
    let moovOffset = -1;
    let mdatOffset = -1;

    while (offset < buf.length - 8) {
      const size = buf.readUInt32BE(offset);
      const type = buf.toString('ascii', offset + 4, offset + 8);
      if (type === 'moov' && moovOffset === -1) moovOffset = offset;
      if (type === 'mdat' && mdatOffset === -1) mdatOffset = offset;
      if (size === 0 || size === 1 || size < 8) break;
      offset += size;
    }

    const faststart = moovOffset !== -1 && mdatOffset !== -1 && moovOffset < mdatOffset;
    return { faststart, moovOffset, mdatOffset };
  } catch (err) {
    return { faststart: false, error: err.message };
  }
}

try {
  // Check 1: file_exists
  if (!fs.existsSync(targetFile)) {
    console.error(`[FAIL] Check 1 (file_exists): File not found at ${targetFile}`);
    process.exit(1);
  }
  const stat = fs.statSync(targetFile);
  if (stat.size === 0) {
    console.error(`[FAIL] Check 1 (file_exists): File size is 0 bytes`);
    process.exit(1);
  }
  console.log(`[PASS] Check 1  | file_exists                 | Size: ${stat.size} bytes`);

  // Run ffprobe
  const probeOutput = execSync(`ffprobe -v quiet -print_format json -show_format -show_streams "${targetFile}"`).toString();
  const probe = JSON.parse(probeOutput);

  const format = probe.format || {};
  const vStream = probe.streams?.find(s => s.codec_type === 'video');
  const aStream = probe.streams?.find(s => s.codec_type === 'audio');

  // Check 2: container_mp4
  const formatName = format.format_name || '';
  const isMp4 = formatName.includes('mp4') || formatName.includes('mov');
  if (!isMp4) throw new Error(`Check 2 failed: Container format '${formatName}' is not MP4`);
  console.log(`[PASS] Check 2  | container_mp4               | Format: ${formatName}`);

  // Check 3: major_brand_valid
  const majorBrand = format.tags?.major_brand || '';
  const validMajorBrands = ['isom', 'mp41', 'mp42', 'qt'];
  const hasValidMajor = validMajorBrands.some(b => majorBrand.toLowerCase().includes(b));
  if (!hasValidMajor) throw new Error(`Check 3 failed: Major brand '${majorBrand}' is not supported`);
  console.log(`[PASS] Check 3  | major_brand_valid           | Major Brand: ${majorBrand}`);

  // Check 4: compatible_brands_valid
  const compatBrands = format.tags?.compatible_brands || '';
  const hasValidCompat = ['isom', 'mp41', 'mp42', 'avc1'].some(b => compatBrands.toLowerCase().includes(b));
  if (!hasValidCompat) throw new Error(`Check 4 failed: Compatible brands '${compatBrands}' not standard`);
  console.log(`[PASS] Check 4  | compatible_brands_valid     | Compatible Brands: ${compatBrands}`);

  // Check 5: moov_before_mdat (faststart)
  const atomCheck = checkAtomOrder(targetFile);
  if (!atomCheck.faststart) {
    throw new Error(`Check 5 failed: 'moov' atom (${atomCheck.moovOffset}) is not before 'mdat' atom (${atomCheck.mdatOffset})`);
  }
  console.log(`[PASS] Check 5  | moov_before_mdat (faststart)| moov: ${atomCheck.moovOffset} < mdat: ${atomCheck.mdatOffset}`);

  // Check 6: video_stream_present
  if (!vStream) throw new Error('Check 6 failed: No video stream found');
  console.log(`[PASS] Check 6  | video_stream_present        | Video stream index: ${vStream.index}`);

  // Check 7: video_codec_h264
  if (vStream.codec_name !== 'h264') throw new Error(`Check 7 failed: Video codec is '${vStream.codec_name}', expected 'h264'`);
  console.log(`[PASS] Check 7  | video_codec_h264            | Video Codec: ${vStream.codec_name}`);

  // Check 8: video_tag_avc1
  const tag = (vStream.codec_tag_string || '').toLowerCase();
  if (tag !== 'avc1') throw new Error(`Check 8 failed: Video codec tag is '${tag}', expected 'avc1'`);
  console.log(`[PASS] Check 8  | video_tag_avc1              | Video Tag: ${vStream.codec_tag_string}`);

  // Check 9: video_pixel_format_yuv420p
  if (vStream.pix_fmt !== 'yuv420p') throw new Error(`Check 9 failed: Pixel format is '${vStream.pix_fmt}', expected 'yuv420p'`);
  console.log(`[PASS] Check 9  | video_pixel_format_yuv420p  | Pixel Format: ${vStream.pix_fmt}`);

  // Check 10: video_profile_supported
  const profile = vStream.profile || '';
  const validProfiles = ['Constrained Baseline', 'Baseline', 'Main', 'High'];
  const profileOk = validProfiles.some(p => profile.toLowerCase().includes(p.toLowerCase()));
  if (!profileOk) throw new Error(`Check 10 failed: Video profile '${profile}' not supported`);
  console.log(`[PASS] Check 10 | video_profile_supported     | Video Profile: ${profile}`);

  // Check 11: video_dimensions_even
  const w = Number(vStream.width);
  const h = Number(vStream.height);
  if (w % 2 !== 0 || h % 2 !== 0) throw new Error(`Check 11 failed: Dimensions ${w}x${h} must be divisible by 2`);
  console.log(`[PASS] Check 11 | video_dimensions_even       | Dimensions: ${w}x${h} (both even)`);

  // Check 12: audio_stream_present
  if (!aStream) throw new Error('Check 12 failed: No audio stream found');
  console.log(`[PASS] Check 12 | audio_stream_present        | Audio stream index: ${aStream.index}`);

  // Check 13: audio_codec_aac
  if (aStream.codec_name !== 'aac') throw new Error(`Check 13 failed: Audio codec is '${aStream.codec_name}', expected 'aac'`);
  console.log(`[PASS] Check 13 | audio_codec_aac             | Audio Codec: ${aStream.codec_name}`);

  // Check 14: audio_tag_mp4a
  const audioTag = (aStream.codec_tag_string || '').toLowerCase();
  if (audioTag !== 'mp4a') throw new Error(`Check 14 failed: Audio codec tag is '${audioTag}', expected 'mp4a'`);
  console.log(`[PASS] Check 14 | audio_tag_mp4a              | Audio Tag: ${aStream.codec_tag_string}`);

  // Check 15: audio_profile_lc
  const aProfile = aStream.profile || '';
  if (!aProfile.includes('LC')) throw new Error(`Check 15 failed: Audio profile is '${aProfile}', expected 'LC'`);
  console.log(`[PASS] Check 15 | audio_profile_lc            | Audio Profile: ${aProfile}`);

  // Check 16: audio_sample_rate_valid
  const sampleRate = Number(aStream.sample_rate);
  if (![44100, 48000].includes(sampleRate)) throw new Error(`Check 16 failed: Audio sample rate ${sampleRate} not 44.1k/48k`);
  console.log(`[PASS] Check 16 | audio_sample_rate_valid     | Sample Rate: ${sampleRate} Hz`);

  // Check 17: audio_channels_valid
  const channels = Number(aStream.channels);
  if (channels < 1 || channels > 2) throw new Error(`Check 17 failed: Channels ${channels} not 1 or 2`);
  console.log(`[PASS] Check 17 | audio_channels_valid        | Channels: ${channels} (${aStream.channel_layout || 'stereo'})`);

  console.log('='.repeat(80));
  console.log('AUDIT RESULT: 17/17 COMPATIBILITY CHECKS PASSED');
  console.log('WHATSAPP_COMPATIBLE: PASS');
  console.log('='.repeat(80));
  process.exit(0);

} catch (err) {
  console.error('\n[AUDIT FAILED]:', err.message);
  console.log('WHATSAPP_COMPATIBLE: FAIL');
  process.exit(1);
}
