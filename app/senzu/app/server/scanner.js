// Senzu Gallery — filesystem scanner + incremental watcher (manager).
// Manages a live set of connected folders: bulk-indexes on demand, watches for
// changes via chokidar, and supports adding/removing/re-indexing folders at
// runtime. Live updates are pushed to clients over Socket.IO.

const fs = require('fs');
const path = require('path');
const chokidar = require('chokidar');
const { enrichImage } = require('./gallery');

// Routine gallery logging is silenced by default so it never interferes with
// the launcher's terminal URL-capture. Set SENZU_GALLERY_LOG=1 to enable.
const glog = process.env.SENZU_GALLERY_LOG === '1' ? (...a) => console.log(...a) : () => {};

const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.tiff', '.tif'];

function isImage(filePath) {
  return IMAGE_EXTS.includes(path.extname(filePath).toLowerCase());
}

async function walk(dir, recursive = true, out = []) {
  let entries;
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch (_) {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (recursive) await walk(full, recursive, out);
    } else if (entry.isFile() && isImage(full)) {
      out.push(full);
    }
  }
  return out;
}

async function indexFile(db, parser, filePath, rootPath) {
  const stats = await fs.promises.stat(filePath);
  const metadata = await parser.parse(filePath);
  return db.indexImage(filePath, rootPath, metadata, stats);
}

// Create a gallery scan/watch manager. `staticRoot` is the dir served at
// /outputs (used to build web src URLs for in-tree files).
function createManager({ db, parser, io, staticRoot }) {
  let roots = [];      // [{ path, recursive }]
  let watcher = null;

  function rootFor(filePath) {
    let best = null;
    for (const r of roots) {
      if (filePath === r.path || filePath.startsWith(r.path + path.sep)) {
        if (!best || r.path.length > best.path.length) best = r;
      }
    }
    return best;
  }

  async function scanFolder(rootPath, recursive, force) {
    if (!fs.existsSync(rootPath)) return { indexed: 0 };
    const files = await walk(rootPath, recursive);
    const total = files.length;
    glog(`[Gallery] Scanning ${total} file(s) in ${rootPath}...`);

    let current = 0;
    let indexed = 0;
    for (const file of files) {
      current++;
      try {
        const existing = db.getImageByPath(file);
        if (!existing) {
          const image = await indexFile(db, parser, file, rootPath);
          indexed++;
          if (io && image) io.emit('gallery-new', enrichImage(image, staticRoot));
        } else if (force) {
          await indexFile(db, parser, file, rootPath);
        }
      } catch (err) {
        console.error(`[Gallery] Failed to index ${path.basename(file)}: ${err.message}`);
      }
      if (io && (current % 10 === 0 || current === total)) {
        io.emit('gallery-progress', { current, total });
      }
    }
    if (io) io.emit('gallery-progress', { current: total, total, done: true });
    glog(`[Gallery] Scan of ${rootPath} complete. Indexed ${indexed} new. Total: ${db.getCount()}`);
    return { indexed };
  }

  async function onAdd(filePath) {
    if (!isImage(filePath)) return;
    const r = rootFor(filePath);
    const rootPath = r ? r.path : path.dirname(filePath);
    // Skip subfolder files for non-recursive connected folders.
    if (r && !r.recursive && path.dirname(filePath) !== r.path) return;

    // Wait for write stability — poll mtime until it stops changing.
    let lastMtime;
    let attempts = 20;
    while (true) {
      let stat;
      try { stat = await fs.promises.stat(filePath); } catch (_) { return; }
      if (stat.mtimeMs === lastMtime) break;
      lastMtime = stat.mtimeMs;
      attempts--;
      if (attempts <= 0) {
        glog(`[Gallery] Gave up waiting for write stability: ${path.basename(filePath)}`);
        return;
      }
      await new Promise(res => setTimeout(res, 1000));
    }
    await new Promise(res => setTimeout(res, 300));

    let image = null;
    for (let i = 0; i < 5; i++) {
      try {
        if (db.getImageByPath(filePath)) return;
        image = await indexFile(db, parser, filePath, rootPath);
        if (image) break;
      } catch (_) {
        await new Promise(res => setTimeout(res, 1000));
      }
    }
    if (image && io) {
      glog(`[Gallery] Indexed new file: ${path.basename(filePath)}`);
      io.emit('gallery-new', enrichImage(image, staticRoot));
    }
  }

  function onUnlink(filePath) {
    if (!isImage(filePath)) return;
    try {
      const fingerprint = db.removeByPath(filePath);
      if (fingerprint && io) {
        glog(`[Gallery] Removed from index: ${path.basename(filePath)}`);
        io.emit('gallery-remove', { fingerprint });
      }
    } catch (err) {
      console.error(`[Gallery] Failed to remove ${path.basename(filePath)}: ${err.message}`);
    }
  }

  function ensureWatcher() {
    if (watcher) return;
    watcher = chokidar.watch([], {
      ignoreInitial: true,
      persistent: true,
      depth: 20,
      awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
    });
    watcher.on('add', onAdd);
    watcher.on('unlink', onUnlink);
  }

  function loadRootsFromDb() {
    roots = db.getFolders().map(f => ({ path: f.path, recursive: f.recursive !== 0 }));
  }

  return {
    // Initial scan of all connected folders + start watching.
    async start({ force = false } = {}) {
      loadRootsFromDb();
      ensureWatcher();
      for (const r of roots) await scanFolder(r.path, r.recursive, force);
      for (const r of roots) if (fs.existsSync(r.path)) watcher.add(r.path);
      glog(`[Gallery] Watching ${roots.length} folder(s).`);
    },

    async addFolder(folderPath, recursive = true) {
      db.addFolder(folderPath, recursive);
      if (!roots.some(r => r.path === folderPath)) roots.push({ path: folderPath, recursive });
      ensureWatcher();
      await scanFolder(folderPath, recursive, false);
      if (fs.existsSync(folderPath)) watcher.add(folderPath);
    },

    removeFolder(folderPath) {
      if (watcher) { try { watcher.unwatch(folderPath); } catch (_) {} }
      roots = roots.filter(r => r.path !== folderPath);
      db.removeFolder(folderPath); // also purges images with this root_path
    },

    async reindexFolder(folderPath) {
      const r = roots.find(x => x.path === folderPath);
      await scanFolder(folderPath, r ? r.recursive : true, true);
    },

    async reindexAll() {
      loadRootsFromDb();
      for (const r of roots) await scanFolder(r.path, r.recursive, true);
    },

    getRoots() { return roots.map(r => ({ ...r })); }
  };
}

module.exports = { createManager, isImage, walk };
