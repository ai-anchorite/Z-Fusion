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

function createGalleryRouter({ db, outputsRoot, trashDir, thumbDir, reindex, openFolder, manager, pickFolder, protectedFolders = [] }) {
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

  // --- Open the folder that contains an image ---
  router.post('/open', (req, res) => {
    if (typeof openFolder !== 'function') return res.status(501).json({ error: 'Not available' });
    const { fingerprint } = req.body || {};
    const img = db.getImage(fingerprint);
    if (!img) return res.status(404).json({ error: 'Not found' });
    const dir = path.dirname(img.file_path);
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

  // --- Single image (keep LAST — catch-all param route) ---
  router.get('/:fingerprint', (req, res) => {
    const img = db.getImage(req.params.fingerprint);
    if (!img) return res.status(404).json({ error: 'Not found' });
    res.json(enrich(img));
  });

  return router;
}

module.exports = { createGalleryRouter, enrichImage };
