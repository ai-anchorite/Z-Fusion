const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const glog = process.env.SENZU_GALLERY_LOG === '1' ? (...a) => console.log(...a) : () => {};

let _detectedHw = undefined;

function detectHardwareEncoder() {
  if (_detectedHw !== undefined) return Promise.resolve(_detectedHw);

  const venvDir = path.resolve(__dirname, '..', 'env');
  const pythonExe = process.platform === 'win32'
    ? path.join(venvDir, 'Scripts', 'python.exe')
    : path.join(venvDir, 'bin', 'python');

  const script = `import torch
if torch.cuda.is_available():
  n=torch.cuda.get_device_name(0).lower()
  print("rocm" if any(x in n for x in["amd","radeon","instinct"]) else "cuda")
elif torch.backends.mps.is_available(): print("mps")
else: print("cpu")`;

  return new Promise((resolve) => {
    execFile(pythonExe, ['-c', script], { timeout: 5000, windowsHide: true }, (err, stdout) => {
      if (err) { _detectedHw = null; console.log('[Video] Torch GPU probe failed — using libx264'); return resolve(null); }
      const gpu = (stdout || '').trim();
      if (gpu === 'rocm') _detectedHw = 'mf';
      else if (gpu === 'cuda') _detectedHw = 'nvenc';
      else if (gpu === 'mps') _detectedHw = 'videotoolbox';
      else { _detectedHw = null; console.log(`[Video] Torch reports '${gpu}' — using libx264`); return resolve(null); }
      console.log(`[Video] Hardware encoder: ${_detectedHw} (${gpu})`);
      resolve(_detectedHw);
    });
  });
}

function hwEncoderArgs(hw) {
  switch (hw) {
    case 'nvenc':       return ['-c:v', 'h264_nvenc', '-preset', 'p4', '-cq', '23'];
    case 'mf':          return ['-c:v', 'h264_mf'];
    case 'videotoolbox': return ['-c:v', 'h264_videotoolbox', '-q:v', '65'];
    default:            return ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23'];
  }
}

function getCachePath(video, cacheDir) {
  return path.join(cacheDir, `${video.fingerprint}.mp4`);
}

function fileAge(filePath) {
  try { return fs.statSync(filePath).mtimeMs; } catch (_) { return 0; }
}

function isCached(video, cacheDir) {
  const cached = getCachePath(video, cacheDir);
  if (!fs.existsSync(cached)) return false;
  const srcMtime = fileAge(video.file_path);
  const cacheMtime = fileAge(cached);
  return cacheMtime >= srcMtime;
}

function remuxToMp4(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    glog(`[Transcode] Remuxing: ${path.basename(inputPath)}`);
    const proc = execFile('ffmpeg', [
      '-y', '-i', inputPath,
      '-c', 'copy',
      '-movflags', '+faststart',
      outputPath
    ], { timeout: 300000, windowsHide: true, maxBuffer: 1024 * 256 }, (err) => {
      if (err) { cleanupStale(outputPath); return reject(err); }
      if (fs.existsSync(outputPath)) return resolve(outputPath);
      reject(new Error('Remux produced no output'));
    });
    proc.stderr?.on('data', () => {});
  });
}

function transcodeToMp4(inputPath, outputPath, hw) {
  return new Promise((resolve, reject) => {
    const args = hwEncoderArgs(hw);
    glog(`[Transcode] Encoding (${hw || 'libx264'}): ${path.basename(inputPath)}`);
    const proc = execFile('ffmpeg', [
      '-y', '-i', inputPath,
      ...args,
      '-c:a', 'aac', '-b:a', '128k',
      '-movflags', '+faststart',
      outputPath
    ], { timeout: 600000, windowsHide: true, maxBuffer: 1024 * 256 }, (err) => {
      if (err) { cleanupStale(outputPath); return reject(err); }
      if (fs.existsSync(outputPath)) return resolve(outputPath);
      reject(new Error('Transcode produced no output'));
    });
    proc.stderr?.on('data', () => {});
  });
}

function cleanupStale(filePath) {
  try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (_) {}
}

async function ensureCompatible(video, cacheDir, hw) {
  const cached = getCachePath(video, cacheDir);

  if (isCached(video, cacheDir)) return cached;

  if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });

  let encoder = hw;
  if (encoder === undefined) encoder = await detectHardwareEncoder();

  const strategy = video.playback_strategy || 'transcode';

  if (strategy === 'remux') {
    await remuxToMp4(video.file_path, cached);
  } else {
    await transcodeToMp4(video.file_path, cached, encoder);
  }

  return cached;
}

module.exports = { detectHardwareEncoder, ensureCompatible, getCachePath, isCached };
