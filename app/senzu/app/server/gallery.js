// Senzu Gallery — Express route handlers for /api/gallery/*
// Thin wrapper around GalleryDatabase. All image results are enriched with a
// web-servable `src`: /outputs/... for files under the Senzu output tree, or
// the DB-whitelisted /api/gallery/file/<fingerprint> route for connected
// folders elsewhere on disk.

const express = require('express');
const path = require('path');
const fs = require('fs');

function enrichImage(image, outputsRoot) {
  if (!image) return image;
  const rel = outputsRoot ? path.relative(outputsRoot, image.file_path) : '..';
  let src;
  if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
    src = '/outputs/' + rel.split(path.sep).map(encodeURIComponent).join('/');
  } else {
    src = '/api/gallery/file/' + encodeURIComponent(image.fingerprint);
  }
  const thumb = '/api/gallery/thumbnail/' + encodeURIComponent(image.fingerprint) + '?w=480';
  return { ...image, src, thumb };
}

function createGalleryRouter({ db, outputsRoot, trashDir, thumbDir, cropOutputDir, reindex, openFolder, manager, pickFolder, protectedFolders = [] }) {
  const router = express.Router();
  const enrich = (img) => enrichImage(img, outputsRoot);
  const withRemovable = (f) => ({ ...f, removable: !protectedFolders.includes(f.path) });

  // --- Thumbnail ---
  router.get('/thumbnail/:fingerprint', async (req, res) => {
    try {
      const img = db.getImage(req.params.fingerprint);
      if (!img || !img.file_path || !fs.existsSync(img.file_path)) return res.status(404).end();
      const w = Math.min(1200, Math.max(60, parseInt(req.query.w, 10) || 480));
      const cacheFile = path.join(thumbDir, `${img.fingerprint}_w${w}.webp`);
      if (fs.existsSync(cacheFile)) return res.sendFile(cacheFile);
      const sharp = require('sharp');
      await sharp(img.file_path)
        .resize(w, null, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 80 })
        .toFile(cacheFile);
      res.sendFile(cacheFile);
    } catch (err) {
      console.error('[Gallery] thumbnail error:', err.message);
      res.status(500).end();
    }
  });

  // --- Search ---
  router.get('/search', (req, res) => {
    try {
      const q = req.query.q || '';
      const sort = req.query.sort || 'btime';
      const direction = parseInt(req.query.direction, 10) === 1 ? 1 : -1;
      const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
      const limit = Math.min(1000, Math.max(100, parseInt(req.query.limit, 10) || 100));

      const result = db.search(q, { sort, direction, offset, limit });
      result.results = result.results.map(enrich);
      res.json(result);
    } catch (err) {
      console.error('[Gallery] search error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/count', (req, res) => {
    res.json({ count: db.getCount() });
  });

  router.get('/tags', (req, res) => {
    res.json(db.getAllTags());
  });

  // --- Trash ---
  router.get('/trash', (req, res) => {
    res.json(db.getTrash());
  });

  router.post('/trash/empty', (req, res) => {
    const count = db.emptyTrash();
    res.json({ success: true, count });
  });

  router.post('/trash/open', (req, res) => {
    if (typeof openFolder !== 'function') return res.status(501).json({ error: 'Not available' });
    const result = openFolder(trashDir);
    result && result.success ? res.json({ success: true }) : res.status(500).json(result || { error: 'Failed' });
  });

  // --- Folders (connected folders) ---
  router.get('/folders', (req, res) => {
    res.json(db.getFolderBookmarks().map(withRemovable));
  });

  router.post('/folders', async (req, res) => {
    const { path: folderPath, recursive } = req.body || {};
    if (!folderPath) return res.status(400).json({ error: 'Missing path' });
    let stat;
    try { stat = fs.statSync(folderPath); } catch (_) { return res.status(400).json({ error: 'Folder does not exist' }); }
    if (!stat.isDirectory()) return res.status(400).json({ error: 'Not a folder' });
    if (db.getFolders().some(f => f.path === folderPath)) {
      return res.status(409).json({ error: 'Folder is already connected' });
    }
    try {
      if (manager) await manager.addFolder(folderPath, recursive !== false);
      else db.addFolder(folderPath, recursive !== false);
      res.json({ success: true, folders: db.getFolderBookmarks().map(withRemovable) });
    } catch (err) {
      console.error('[Gallery] add folder error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  router.delete('/folders', (req, res) => {
    const { path: folderPath } = req.body || {};
    if (!folderPath) return res.status(400).json({ error: 'Missing path' });
    if (protectedFolders.includes(folderPath)) {
      return res.status(403).json({ error: 'This folder cannot be removed' });
    }
    if (manager) manager.removeFolder(folderPath);
    else db.removeFolder(folderPath);
    res.json({ success: true, folders: db.getFolderBookmarks().map(withRemovable) });
  });

  router.post('/folders/reindex', async (req, res) => {
    const { path: folderPath } = req.body || {};
    if (!folderPath) return res.status(400).json({ error: 'Missing path' });
    try {
      if (manager) await manager.reindexFolder(folderPath);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- Native folder picker ---
  router.post('/pick-folder', async (req, res) => {
    if (typeof pickFolder !== 'function') return res.status(501).json({ error: 'Picker not available' });
    try {
      res.json(await pickFolder());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- Settings ---
  router.get('/settings/:key', (req, res) => {
    res.json({ key: req.params.key, val: db.getSetting(req.params.key) });
  });

  router.put('/settings/:key', (req, res) => {
    const { val } = req.body || {};
    db.setSetting(req.params.key, val);
    res.json({ success: true });
  });

  // --- Favorites (saved searches) ---
  router.get('/favorites', (req, res) => {
    res.json(db.getFavorites());
  });

  router.post('/favorites', (req, res) => {
    const { query, label, isGlobal } = req.body || {};
    if (query == null) return res.status(400).json({ error: 'Missing query' });
    const id = db.addFavorite(query, label, isGlobal === true);
    res.json({ success: true, id });
  });

  router.delete('/favorites/:id', (req, res) => {
    db.removeFavorite(parseInt(req.params.id, 10));
    res.json({ success: true });
  });

  // --- Tags mutation ---
  router.post('/tags/add', (req, res) => {
    const { fingerprints, tags } = req.body || {};
    if (!Array.isArray(fingerprints) || !Array.isArray(tags)) {
      return res.status(400).json({ error: 'fingerprints and tags must be arrays' });
    }
    db.addTags(fingerprints, tags);
    res.json({ success: true, images: fingerprints.map(fp => enrich(db.getImage(fp))).filter(Boolean) });
  });

  router.post('/tags/remove', (req, res) => {
    const { fingerprints, tags } = req.body || {};
    if (!Array.isArray(fingerprints) || !Array.isArray(tags)) {
      return res.status(400).json({ error: 'fingerprints and tags must be arrays' });
    }
    db.removeTags(fingerprints, tags);
    res.json({ success: true, images: fingerprints.map(fp => enrich(db.getImage(fp))).filter(Boolean) });
  });

  // --- Soft delete / restore ---
  router.post('/delete', (req, res) => {
    const { fingerprints } = req.body || {};
    if (!Array.isArray(fingerprints)) return res.status(400).json({ error: 'fingerprints must be an array' });
    const results = db.softDelete(fingerprints, trashDir);
    res.json({ success: true, deleted: results.map(r => r.fingerprint) });
  });

  router.post('/restore', (req, res) => {
    const { fingerprints } = req.body || {};
    if (!Array.isArray(fingerprints)) return res.status(400).json({ error: 'fingerprints must be an array' });
    const results = db.restoreFromTrash(fingerprints);
    res.json({ success: true, restored: results.map(r => r.fingerprint) });
  });

  // --- Full re-index (re-scan + re-parse metadata) ---
  router.post('/reindex', async (req, res) => {
    if (typeof reindex !== 'function') {
      return res.status(501).json({ error: 'Re-index is not available' });
    }
    try {
      const count = await reindex();
      res.json({ success: true, count });
    } catch (err) {
      console.error('[Gallery] reindex error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // --- Open the folder that contains a file ---
  router.post('/open', (req, res) => {
    if (typeof openFolder !== 'function') return res.status(501).json({ error: 'Not available' });
    const { fingerprint, file_path } = req.body || {};
    let fp = file_path;
    if (!fp) {
      const img = db.getImage(fingerprint);
      if (!img) return res.status(404).json({ error: 'Not found' });
      fp = img.file_path;
    }
    const dir = path.dirname(fp);
    if (!fs.existsSync(dir)) return res.status(404).json({ error: 'Folder no longer exists' });
    const result = openFolder(dir);
    result && result.success ? res.json({ success: true }) : res.status(500).json(result || { error: 'Failed' });
  });

  // --- DB-whitelisted file serving (for connected folders outside /outputs) ---
  router.get('/file/:fingerprint', (req, res) => {
    const img = db.getImage(req.params.fingerprint);
    if (!img || !img.file_path || !fs.existsSync(img.file_path)) return res.status(404).end();
    res.sendFile(img.file_path, (err) => {
      if (err && !res.headersSent) res.status(404).end();
    });
  });

  // --- Crop ---
  router.post('/crop', async (req, res) => {
    try {
      const { fingerprint, x, y, width, height } = req.body || {};
      if (!fingerprint || x == null || y == null || !width || !height) {
        return res.status(400).json({ error: 'Missing required crop parameters' });
      }
      const img = db.getImage(fingerprint);
      if (!img || !img.file_path || !fs.existsSync(img.file_path)) {
        return res.status(404).json({ error: 'Source image not found' });
      }

      const cx = Math.max(0, Math.round(Number(x)));
      const cy = Math.max(0, Math.round(Number(y)));
      const cw = Math.min(Math.max(10, Math.round(Number(width))), (img.width || 1) - cx);
      const ch = Math.min(Math.max(10, Math.round(Number(height))), (img.height || 1) - cy);
      if (cw < 10 || ch < 10) {
        return res.status(400).json({ error: 'Crop region too small (minimum 10x10 pixels)' });
      }

      if (!fs.existsSync(cropOutputDir)) {
        fs.mkdirSync(cropOutputDir, { recursive: true });
      }

      const ext = path.extname(img.filename) || '.png';
      const baseName = path.basename(img.filename, ext);
      const outName = `${baseName}_crop_${Date.now().toString(36)}${ext}`;
      const outPath = path.join(cropOutputDir, outName);

      const sharp = require('sharp');
      await sharp(img.file_path)
        .extract({ left: cx, top: cy, width: cw, height: ch })
        .toFile(outPath);

      const rel = outputsRoot ? path.relative(outputsRoot, outPath) : outPath;
      const src = '/outputs/' + rel.split(path.sep).map(encodeURIComponent).join('/');

      res.json({ success: true, filename: outName, src });
    } catch (err) {
      console.error('[Gallery] crop error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // --- Single image (keep LAST — catch-all param route) ---
  router.get('/:fingerprint', (req, res) => {
    const img = db.getImage(req.params.fingerprint);
    if (!img) return res.status(404).json({ error: 'Not found' });
    res.json(enrich(img));
  });

  return router;
}

// Video gallery router — /api/gallery/videos/*
function createVideoRouter({ videoDb, outputsRoot, trashDir, thumbDir, screenshotDir, scanFolder, cacheDir, hwEncoder }) {
  const router = express.Router();

  function enrichVideo(v) {
    if (!v) return v;
    // Direct-playback files can use the fast /outputs/ static path.
    // Non-direct files MUST go through /api/gallery/videos/file/ for transcoding.
    const useDirect = v.playback_strategy === 'direct';
    let src;
    if (useDirect) {
      const rel = outputsRoot ? path.relative(outputsRoot, v.file_path) : '..';
      if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
        src = '/outputs/' + rel.split(path.sep).map(encodeURIComponent).join('/');
      } else {
        src = '/api/gallery/videos/file/' + encodeURIComponent(v.fingerprint);
      }
    } else {
      src = '/api/gallery/videos/file/' + encodeURIComponent(v.fingerprint);
    }
    const thumb = v.thumbnail_path ? '/api/gallery/videos/thumb/' + encodeURIComponent(v.fingerprint) : null;
    return { ...v, src, thumb };
  }

  // Thumbnail
  router.get('/thumb/:fingerprint', (req, res) => {
    const v = videoDb.getVideo(req.params.fingerprint);
    if (!v || !v.thumbnail_path || !fs.existsSync(v.thumbnail_path)) return res.status(404).end();
    res.sendFile(v.thumbnail_path);
  });

  // Search
  router.get('/search', (req, res) => {
    try {
      const q = req.query.q || '';
      const sort = req.query.sort || 'btime';
      const direction = parseInt(req.query.direction, 10) === 1 ? 1 : -1;
      const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
      const limit = Math.min(1000, Math.max(100, parseInt(req.query.limit, 10) || 100));
      const result = videoDb.search(q, { sort, direction, offset, limit });
      result.results = result.results.map(enrichVideo);
      res.json(result);
    } catch (err) {
      console.error('[VideoGallery] search error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/count', (req, res) => {
    res.json({ count: videoDb.getCount() });
  });

  router.get('/tags', (req, res) => {
    res.json(videoDb.getAllTags());
  });

  // Tags mutation
  router.post('/tags/add', (req, res) => {
    const { fingerprints, tags } = req.body || {};
    if (!Array.isArray(fingerprints) || !Array.isArray(tags)) {
      return res.status(400).json({ error: 'fingerprints and tags must be arrays' });
    }
    videoDb.addTags(fingerprints, tags);
    res.json({ success: true });
  });

  router.post('/tags/remove', (req, res) => {
    const { fingerprints, tags } = req.body || {};
    if (!Array.isArray(fingerprints) || !Array.isArray(tags)) {
      return res.status(400).json({ error: 'fingerprints and tags must be arrays' });
    }
    videoDb.removeTags(fingerprints, tags);
    res.json({ success: true });
  });

  // Delete / Trash
  router.post('/delete', (req, res) => {
    const { fingerprints } = req.body || {};
    if (!Array.isArray(fingerprints)) return res.status(400).json({ error: 'fingerprints must be an array' });
    const results = videoDb.softDelete(fingerprints, trashDir);
    res.json({ success: true, deleted: results.map(r => r.fingerprint) });
  });

  // File serving
  router.get('/file/:fingerprint', async (req, res) => {
    const v = videoDb.getVideo(req.params.fingerprint);
    if (!v || !v.file_path) return res.status(404).end();

    let servePath = v.file_path;
    let mimeType = v.mime_type || 'video/mp4';

    if (v.playback_strategy !== 'direct') {
      try {
        const { ensureCompatible } = require('./video-transcode');
        servePath = await ensureCompatible(v, cacheDir, hwEncoder);
        mimeType = 'video/mp4';
      } catch (err) {
        console.error(`[VideoGallery] Transcode failed for ${v.filename}:`, err.message);
        // Fall back to original file — browser may still play it
        servePath = v.file_path;
      }
    }

    if (!fs.existsSync(servePath)) return res.status(404).end();

    const stat = fs.statSync(servePath);
    const fileSize = stat.size;
    if (fileSize === 0) return res.status(500).json({ error: 'Empty file' });
    const range = req.headers.range;
    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunksize = (end - start) + 1;
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': mimeType,
      });
      fs.createReadStream(servePath, { start, end }).pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': mimeType,
      });
      fs.createReadStream(servePath).pipe(res);
    }
  });

  // Frame capture (screenshot)
  router.post('/capture-frame', (req, res) => {
    try {
      const { dataUrl, filename } = req.body || {};
      if (!dataUrl || !filename) return res.status(400).json({ error: 'Missing dataUrl or filename' });
      const base64Data = dataUrl.replace(/^data:image\/\w+;base64,/, '');
      const buf = Buffer.from(base64Data, 'base64');
      if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true });
      const outPath = path.join(screenshotDir, filename);
      fs.writeFileSync(outPath, buf);
      const rel = outputsRoot ? path.relative(outputsRoot, outPath) : outPath;
      const src = '/outputs/' + rel.split(path.sep).map(encodeURIComponent).join('/');
      res.json({ saved: true, filename, src });
    } catch (err) {
      console.error('[VideoGallery] capture error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // Folders
  router.get('/folders', (req, res) => {
    res.json(videoDb.getFolderBookmarks().map(f => ({ ...f, removable: true })));
  });

  router.post('/folders', async (req, res) => {
    const { path: folderPath, recursive } = req.body || {};
    if (!folderPath) return res.status(400).json({ error: 'Missing path' });
    let stat;
    try { stat = fs.statSync(folderPath); } catch (_) { return res.status(400).json({ error: 'Folder does not exist' }); }
    if (!stat.isDirectory()) return res.status(400).json({ error: 'Not a folder' });
    videoDb.addFolder(folderPath, recursive !== false);
    if (scanFolder) {
      try { await scanFolder(folderPath, recursive !== false); } catch (err) {
        console.error('[VideoGallery] scan folder error:', err.message);
      }
    }
    res.json({ success: true, folders: videoDb.getFolderBookmarks().map(f => ({ ...f, removable: true })) });
  });

  router.delete('/folders', (req, res) => {
    const { path: folderPath } = req.body || {};
    if (!folderPath) return res.status(400).json({ error: 'Missing path' });
    videoDb.removeFolder(folderPath);
    res.json({ success: true, folders: videoDb.getFolderBookmarks().map(f => ({ ...f, removable: true })) });
  });

  // Single video
  router.get('/:fingerprint', (req, res) => {
    const v = videoDb.getVideo(req.params.fingerprint);
    if (!v) return res.status(404).json({ error: 'Not found' });
    res.json(enrichVideo(v));
  });

  return router;
}

module.exports = { createGalleryRouter, createVideoRouter, enrichImage };
