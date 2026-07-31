const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const glog = process.env.SENZU_GALLERY_LOG === '1' ? (...a) => console.log(...a) : () => {};

const VIDEO_EXTS = ['.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v', '.flv', '.wmv', '.3gp', '.ogv'];

const MIME_TYPES = {
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime',
  '.webm': 'video/webm', '.ogv': 'video/ogg', '.avi': 'video/x-msvideo',
  '.mkv': 'video/x-matroska', '.flv': 'video/x-flv', '.wmv': 'video/x-ms-wmv',
  '.3gp': 'video/3gpp'
};

function isVideo(filePath) {
  return VIDEO_EXTS.includes(path.extname(filePath).toLowerCase());
}

function inferPlaybackStrategy(filePath, meta = {}) {
  const ext = path.extname(filePath).toLowerCase();
  const vc = (meta.videoCodec || '').toLowerCase();
  const fn = (meta.formatName || '').toLowerCase();

  // Direct browser playback — container and codec both natively supported
  const isMp4 = ['.mp4', '.m4v'].includes(ext);
  const isMov = ext === '.mov' || /(mov|quicktime)/.test(fn);
  const isWebm = ext === '.webm' || /webm/.test(fn);
  const isOgg = ext === '.ogv' || /ogg/.test(fn);

  if (isMp4 && ['h264', 'avc1', 'hevc', 'h265', 'av1'].includes(vc)) return 'direct';
  if (isMov && ['h264', 'avc1'].includes(vc)) return 'direct';
  if (isWebm && ['vp8', 'vp9', 'av1'].includes(vc)) return 'direct';
  if (isOgg && ['theora'].includes(vc)) return 'direct';

  // Codec is H.264 but container isn't — remux without re-encoding (blazing fast)
  if (['h264', 'avc1'].includes(vc)) return 'remux';

  // Codec not browser-compatible — full transcode needed
  return 'transcode';
}

function parseFrameRate(rate) {
  if (!rate || typeof rate !== 'string') return null;
  const parts = rate.split('/');
  if (parts.length === 2) {
    const n = parseFloat(parts[0]), d = parseFloat(parts[1]);
    if (!isNaN(n) && !isNaN(d) && d !== 0) return n / d;
  }
  const f = parseFloat(rate);
  return isNaN(f) ? null : f;
}

async function getVideoMetadata(filePath) {
  return new Promise((resolve) => {
    execFile('ffprobe', [
      '-v', 'error', '-show_entries',
      'format=format_name,duration:stream=index,codec_type,codec_name,width,height,duration,r_frame_rate',
      '-of', 'json', filePath
    ], { timeout: 30000, windowsHide: true, maxBuffer: 1024 * 256 }, (err, stdout) => {
      if (err || !stdout) return resolve(null);
      try {
        const data = JSON.parse(stdout);
        const vs = data.streams?.find(s => s.codec_type === 'video');
        const as = data.streams?.find(s => s.codec_type === 'audio');
        if (!vs) return resolve(null);
        const w = parseInt(vs.width), h = parseInt(vs.height);
        const duration = parseFloat(vs.duration || data.format?.duration);
        const fps = parseFrameRate(vs.r_frame_rate);
        const ext = path.extname(filePath).toLowerCase();
        const meta = {
          width: isNaN(w) ? null : w, height: isNaN(h) ? null : h,
          duration: isNaN(duration) ? null : duration,
          fps: fps && !isNaN(fps) ? fps : null,
          aspectRatio: (w && h) ? w / h : null,
          formatName: data.format?.format_name || null,
          mimeType: MIME_TYPES[ext] || 'application/octet-stream',
          videoCodec: vs.codec_name || null,
          audioCodec: as?.codec_name || null,
          playbackStrategy: inferPlaybackStrategy(filePath, { videoCodec: vs.codec_name, formatName: data.format?.format_name }),
        };
        resolve(meta);
      } catch (_) { resolve(null); }
    });
  });
}

async function generateThumbnail(filePath, fingerprint, thumbDir) {
  if (!thumbDir) return null;
  if (!fs.existsSync(thumbDir)) fs.mkdirSync(thumbDir, { recursive: true });
  const thumbPath = path.join(thumbDir, `${fingerprint}.jpg`);
  if (fs.existsSync(thumbPath)) return thumbPath;
  return new Promise((resolve) => {
    execFile('ffmpeg', [
      '-y', '-ss', '0', '-i', filePath, '-vframes', '1', '-q:v', '4', thumbPath
    ], { timeout: 30000, windowsHide: true }, (err) => {
      if (err) { glog('[VideoScanner] Thumbnail failed:', path.basename(filePath)); return resolve(null); }
      resolve(fs.existsSync(thumbPath) ? thumbPath : null);
    });
  });
}

async function scanFile(db, filePath, rootPath, thumbDir) {
  try {
    const stats = await fs.promises.stat(filePath);
    if (!stats.isFile() || !isVideo(filePath)) return null;

    const existing = db.getVideoStub(filePath);
    const hasMeta = existing && existing.playback_strategy && existing.mime_type;
    if (existing && existing.mtime === Math.floor(stats.mtimeMs) && hasMeta) {
      // Fix stale playback_strategy (e.g. H.264 MKVs previously flagged as 'transcode')
      const vc = (existing.video_codec || '').toLowerCase();
      const strategy = inferPlaybackStrategy(filePath, { videoCodec: vc, formatName: existing.format_name });
      if (strategy !== existing.playback_strategy) {
        db.db.prepare('UPDATE videos SET playback_strategy = ? WHERE fingerprint = ?')
          .run(strategy, existing.fingerprint);
      }
      if (!existing.thumbnail_path) {
        const tp = await generateThumbnail(filePath, existing.fingerprint, thumbDir);
        if (tp) db.setThumbnail(existing.fingerprint, tp);
      }
      return db.getVideo(existing.fingerprint);
    }

    const dimensions = await getVideoMetadata(filePath);
    const video = await db.indexVideo(filePath, rootPath, dimensions, stats);

    if (video && video.fingerprint) {
      const tp = await generateThumbnail(filePath, video.fingerprint, thumbDir);
      if (tp) {
        db.setThumbnail(video.fingerprint, tp);
        video.thumbnail_path = tp;
      }
    }
    return video;
  } catch (err) {
    console.error('[VideoScanner] Error scanning:', path.basename(filePath), err.message);
    return null;
  }
}

async function scanDirectory(db, dirPath, thumbDir, recursive = true, onProgress) {
  if (!fs.existsSync(dirPath)) return [];
  const results = [];
  let scanned = 0;

  async function walk(dir, depth = 0) {
    if (!recursive && depth > 0) return;
    if (depth > 12) return;
    let entries;
    try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); }
    catch (_) { return; }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full, depth + 1);
      else if (entry.isFile() && isVideo(full)) {
        const video = await scanFile(db, full, dirPath, thumbDir);
        if (video) results.push(video);
        scanned++;
        if (onProgress) onProgress({ current: scanned });
      }
    }
  }

  if (onProgress) onProgress({ type: 'start' });
  await walk(dirPath);
  if (onProgress) onProgress({ current: scanned, total: scanned, done: true });
  return results;
}

module.exports = { isVideo, getVideoMetadata, generateThumbnail, scanFile, scanDirectory };
