const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const glog = process.env.SENZU_GALLERY_LOG === '1' ? (...a) => console.log(...a) : () => {};

class VideoDatabase {
  constructor(dbPath) {
    this.dbPath = dbPath;
    this.db = null;
    this.init();
  }

  init() {
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS videos (
        fingerprint TEXT PRIMARY KEY,
        file_path TEXT NOT NULL,
        filename TEXT NOT NULL,
        root_path TEXT,
        subfolder TEXT,
        size INTEGER NOT NULL,
        width INTEGER,
        height INTEGER,
        duration REAL,
        fps REAL,
        aspect_ratio REAL,
        format_name TEXT,
        mime_type TEXT,
        video_codec TEXT,
        audio_codec TEXT,
        playback_strategy TEXT,
        thumbnail_path TEXT,
        btime INTEGER NOT NULL,
        mtime INTEGER NOT NULL,
        indexed_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS video_tags (
        fingerprint TEXT NOT NULL,
        tag_name TEXT NOT NULL,
        added_at INTEGER NOT NULL,
        PRIMARY KEY (fingerprint, tag_name),
        FOREIGN KEY (fingerprint) REFERENCES videos(fingerprint) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS video_folders (
        path TEXT PRIMARY KEY,
        added_at INTEGER NOT NULL,
        recursive INTEGER NOT NULL DEFAULT 1
      );

      CREATE INDEX IF NOT EXISTS idx_videos_path ON videos(file_path);
      CREATE INDEX IF NOT EXISTS idx_videos_root ON videos(root_path);
      CREATE INDEX IF NOT EXISTS idx_videos_btime ON videos(btime);
    `);

    this._stmts = {
      getByFingerprint: this.db.prepare('SELECT * FROM videos WHERE fingerprint = ?'),
      getByPath: this.db.prepare('SELECT * FROM videos WHERE file_path = ?'),
      deleteVideo: this.db.prepare('DELETE FROM videos WHERE fingerprint = ?'),
      count: this.db.prepare('SELECT COUNT(*) as count FROM videos'),
    };

    glog('[VideoDB] Database initialized:', this.dbPath);
  }

  async computeFingerprint(filePath, stats) {
    const size = Number(stats.size || 0);
    const createdMs = Math.round(stats.birthtimeMs || stats.ctimeMs || stats.mtimeMs || 0);
    const hash = crypto.createHash('sha256');
    const sampleSize = 64 * 1024;
    let handle;
    try {
      if (size > 0) {
        handle = await fs.promises.open(filePath, 'r');
        const buf = Buffer.alloc(Math.min(sampleSize, size));
        await handle.read(buf, 0, buf.length, 0);
        hash.update(buf);
      }
    } catch (_) {
      hash.update(String(size));
    } finally {
      if (handle) { try { await handle.close(); } catch (_) {} }
    }
    hash.update(String(size));
    hash.update(String(createdMs));
    return hash.digest('hex');
  }

  async indexVideo(filePath, rootPath, dimensions, stats) {
    const fingerprint = await this.computeFingerprint(filePath, stats);
    const filename = path.basename(filePath);
    const now = Date.now();

    const dirName = path.dirname(filePath);
    const relative = path.relative(rootPath, dirName);
    const subfolder = (relative && relative !== '.') ? relative : null;

    const stmt = this.db.prepare(`
      INSERT INTO videos (
        fingerprint, file_path, filename, root_path, subfolder, size,
        width, height, duration, fps, aspect_ratio, format_name, mime_type,
        video_codec, audio_codec, playback_strategy,
        btime, mtime, indexed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(fingerprint) DO UPDATE SET
        file_path = excluded.file_path,
        filename = excluded.filename,
        root_path = excluded.root_path,
        subfolder = excluded.subfolder,
        mtime = excluded.mtime,
        indexed_at = excluded.indexed_at,
        width = COALESCE(excluded.width, videos.width),
        height = COALESCE(excluded.height, videos.height),
        duration = COALESCE(excluded.duration, videos.duration),
        fps = COALESCE(excluded.fps, videos.fps),
        aspect_ratio = COALESCE(excluded.aspect_ratio, videos.aspect_ratio),
        format_name = COALESCE(excluded.format_name, videos.format_name),
        mime_type = COALESCE(excluded.mime_type, videos.mime_type),
        video_codec = COALESCE(excluded.video_codec, videos.video_codec),
        audio_codec = COALESCE(excluded.audio_codec, videos.audio_codec),
        playback_strategy = excluded.playback_strategy
    `);

    stmt.run(
      fingerprint, filePath, filename, rootPath, subfolder, Number(stats.size || 0),
      dimensions?.width || null, dimensions?.height || null,
      dimensions?.duration || null, dimensions?.fps || null,
      dimensions?.aspectRatio || null, dimensions?.formatName || null,
      dimensions?.mimeType || null, dimensions?.videoCodec || null,
      dimensions?.audioCodec || null, dimensions?.playbackStrategy || null,
      Math.floor(stats.birthtimeMs || stats.ctimeMs || 0),
      Math.floor(stats.mtimeMs || 0), now
    );

    return this.getVideo(fingerprint);
  }

  getVideo(fingerprint) {
    const video = this._stmts.getByFingerprint.get(fingerprint);
    if (!video) return null;
    video.tags = this.getVideoTags(fingerprint);
    video.id = video.fingerprint;
    return video;
  }

  getVideoByPath(filePath) {
    const video = this._stmts.getByPath.get(filePath);
    if (!video) return null;
    return this.getVideo(video.fingerprint);
  }

  getVideoStub(filePath) {
    return this.db.prepare(
      'SELECT fingerprint, mtime, thumbnail_path, playback_strategy, mime_type, video_codec, format_name FROM videos WHERE file_path = ?'
    ).get(filePath) || null;
  }

  getVideoTags(fingerprint) {
    return this.db.prepare(
      'SELECT tag_name FROM video_tags WHERE fingerprint = ? ORDER BY tag_name COLLATE NOCASE'
    ).all(fingerprint).map(r => r.tag_name);
  }

  setThumbnail(fingerprint, thumbnailPath) {
    this.db.prepare('UPDATE videos SET thumbnail_path = ? WHERE fingerprint = ?').run(thumbnailPath, fingerprint);
  }

  getCount() {
    return this._stmts.count.get().count;
  }

  // --- Tags ---
  addTags(fingerprints, tagNames) {
    const now = Date.now();
    const txn = this.db.transaction(() => {
      for (const tagName of tagNames) {
        const trimmed = String(tagName || '').trim();
        if (!trimmed) continue;
        for (const fp of fingerprints) {
          this.db.prepare(
            'INSERT OR IGNORE INTO video_tags (fingerprint, tag_name, added_at) VALUES (?, ?, ?)'
          ).run(fp, trimmed, now);
        }
      }
    });
    txn();
  }

  removeTags(fingerprints, tagNames) {
    const txn = this.db.transaction(() => {
      for (const tagName of tagNames) {
        const trimmed = String(tagName || '').trim();
        if (!trimmed) continue;
        for (const fp of fingerprints) {
          this.db.prepare(
            'DELETE FROM video_tags WHERE fingerprint = ? AND tag_name = ? COLLATE NOCASE'
          ).run(fp, trimmed);
        }
      }
    });
    txn();
  }

  getAllTags() {
    return this.db.prepare(`
      SELECT tag_name as name, COUNT(fingerprint) as count
      FROM video_tags
      GROUP BY tag_name COLLATE NOCASE
      ORDER BY tag_name COLLATE NOCASE
    `).all();
  }

  // --- Soft Delete / Trash ---
  softDelete(fingerprints, trashDir) {
    if (!fs.existsSync(trashDir)) fs.mkdirSync(trashDir, { recursive: true });
    const results = [];
    const txn = this.db.transaction(() => {
      for (const fp of fingerprints) {
        const video = this._stmts.getByFingerprint.get(fp);
        if (!video) continue;
        const ext = path.extname(video.file_path);
        const trashPath = path.join(trashDir, `${fp}${ext}`);
        try {
          try { fs.renameSync(video.file_path, trashPath); } catch (_) {
            fs.copyFileSync(video.file_path, trashPath);
            fs.unlinkSync(video.file_path);
          }
          this._stmts.deleteVideo.run(fp);
          results.push({ fingerprint: fp, trashPath });
        } catch (e) {
          console.error('[VideoDB] Failed to trash:', video.file_path, e.message);
        }
      }
    });
    txn();
    return results;
  }

  removeByPath(filePath) {
    const video = this._stmts.getByPath.get(filePath);
    if (!video) return null;
    this._stmts.deleteVideo.run(video.fingerprint);
    return video.fingerprint;
  }

  // --- Folders ---
  addFolder(folderPath, recursive = true) {
    this.db.prepare('INSERT OR IGNORE INTO video_folders (path, recursive, added_at) VALUES (?, ?, ?)')
      .run(folderPath, recursive ? 1 : 0, Date.now());
  }

  removeFolder(folderPath) {
    this.db.prepare('DELETE FROM video_folders WHERE path = ?').run(folderPath);
    this.db.prepare("DELETE FROM videos WHERE root_path = ?").run(folderPath);
  }

  getFolders() {
    return this.db.prepare('SELECT * FROM video_folders ORDER BY added_at').all();
  }

  getFolderBookmarks() {
    const folders = this.getFolders();
    const counts = this.db.prepare(`
      SELECT root_path, COUNT(*) as count FROM videos
      WHERE root_path IS NOT NULL AND root_path != ''
      GROUP BY root_path
    `).all();
    const subfolders = this.db.prepare(`
      SELECT root_path, subfolder, COUNT(*) as count FROM videos
      WHERE root_path IS NOT NULL AND root_path != ''
        AND subfolder IS NOT NULL AND subfolder != ''
      GROUP BY root_path, subfolder ORDER BY root_path ASC, subfolder ASC
    `).all();
    const countByRoot = new Map(counts.map(r => [r.root_path, r.count]));
    const sfByRoot = new Map();
    for (const r of subfolders) {
      if (!sfByRoot.has(r.root_path)) sfByRoot.set(r.root_path, []);
      sfByRoot.get(r.root_path).push({ subfolder: r.subfolder, count: r.count });
    }
    return folders.map(f => ({
      ...f, name: path.basename(f.path) || f.path,
      recursive: f.recursive !== 0, count: countByRoot.get(f.path) || 0,
      subfolders: sfByRoot.get(f.path) || [],
    }));
  }

  // --- Search ---
  search(queryString, options = {}) {
    const { sort = 'btime', direction = -1, offset = 0, limit = 100 } = options;
    if (!queryString || !queryString.trim()) {
      return this._getAllSorted(sort, direction, offset, limit);
    }
    const parsed = this._parseQuery(queryString);
    const { conditions, params } = this._buildConditions(parsed);
    const orderDir = direction < 0 ? 'DESC' : 'ASC';
    const orderCol = { btime: 'btime', filename: 'filename', size: 'size', width: 'width', height: 'height', duration: 'duration' }[sort] || 'btime';

    let where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const countRow = this.db.prepare(`SELECT COUNT(*) as count FROM videos ${where}`).get(...params);
    const rows = this.db.prepare(
      `SELECT * FROM videos ${where} ORDER BY ${orderCol} ${orderDir} LIMIT ? OFFSET ?`
    ).all(...params, limit, offset * limit);

    return {
      results: rows.map(r => ({ ...r, tags: this.getVideoTags(r.fingerprint), id: r.fingerprint })),
      count: countRow.count, offset, limit,
    };
  }

  _getAllSorted(sort, direction, offset, limit) {
    const orderDir = direction < 0 ? 'DESC' : 'ASC';
    const orderCol = { btime: 'btime', filename: 'filename', size: 'size', width: 'width', height: 'height', duration: 'duration' }[sort] || 'btime';
    const count = this.getCount();
    const rows = this.db.prepare(
      `SELECT * FROM videos ORDER BY ${orderCol} ${orderDir} LIMIT ? OFFSET ?`
    ).all(limit, offset * limit);
    return {
      results: rows.map(r => ({ ...r, tags: this.getVideoTags(r.fingerprint), id: r.fingerprint })),
      count, offset, limit,
    };
  }

  _parseQuery(queryString) {
    const tokens = [];
    const re = /(-?(?:[\w]+)?:?)?"([^"]+)"|(\S+)/g;
    let m;
    while ((m = re.exec(queryString)) !== null) {
      if (m[1] && m[2]) tokens.push(m[1] + m[2]);
      else if (m[3]) tokens.push(m[3]);
    }
    const parsed = [];
    const numFields = ['width', 'height', 'duration', 'size'];
    const strFields = ['filename', 'root_path', 'subfolder', 'file_path'];
    for (const t of tokens) {
      if (t.startsWith('tag:')) parsed.push({ type: 'tag', value: t.slice(4) });
      else if (t.startsWith('-tag:')) parsed.push({ type: '-tag', value: t.slice(5) });
      else if (t.startsWith('before:')) parsed.push({ type: 'before', value: t.slice(7) });
      else if (t.startsWith('after:')) parsed.push({ type: 'after', value: t.slice(6) });
      else {
        let handled = false;
        for (const f of numFields) {
          const ops = [{ p: `${f}:>=`, o: '>=' }, { p: `${f}:<=`, o: '<=' }, { p: `${f}:>`, o: '>' }, { p: `${f}:<`, o: '<' }, { p: `${f}:`, o: '=' }];
          for (const { p, o } of ops) {
            if (t.startsWith(p)) { const v = t.slice(p.length); if (v && !isNaN(v)) { parsed.push({ type: 'numeric', field: f, op: o, value: parseFloat(v) }); handled = true; break; } }
          }
          if (handled) break;
        }
        if (handled) continue;
        for (const f of strFields) {
          if (t.startsWith(`${f}:`)) { parsed.push({ type: 'field', field: f, value: t.slice(f.length + 1) }); handled = true; break; }
          if (t.startsWith(`-${f}:`)) { parsed.push({ type: '-field', field: f, value: t.slice(f.length + 2) }); handled = true; break; }
        }
        if (!handled) parsed.push({ type: 'filename', value: t });
      }
    }
    return parsed;
  }

  _buildConditions(parsed) {
    const conditions = [];
    const params = [];
    for (const c of parsed) {
      switch (c.type) {
        case 'tag':
          conditions.push(`fingerprint IN (SELECT fingerprint FROM video_tags WHERE tag_name = ? COLLATE NOCASE)`);
          params.push(c.value); break;
        case '-tag':
          conditions.push(`fingerprint NOT IN (SELECT fingerprint FROM video_tags WHERE tag_name = ? COLLATE NOCASE)`);
          params.push(c.value); break;
        case 'before':
          conditions.push('btime <= ?'); params.push(new Date(c.value).getTime()); break;
        case 'after':
          conditions.push('btime >= ?'); params.push(new Date(c.value).getTime()); break;
        case 'numeric':
          conditions.push(`${c.field} ${c.op} ?`); params.push(c.value); break;
        case 'field':
          if (c.field === 'subfolder' || c.field === 'root_path') {
            conditions.push(`${c.field} = ?`);
            params.push(c.value);
          } else {
            conditions.push(`${c.field} LIKE ?`);
            params.push(`%${c.value}%`);
          }
          break;
        case '-field':
          if (c.field === 'subfolder' || c.field === 'root_path') {
            conditions.push(`(${c.field} IS NULL OR ${c.field} != ?)`);
            params.push(c.value);
          } else {
            conditions.push(`(${c.field} IS NULL OR ${c.field} NOT LIKE ?)`);
            params.push(`%${c.value}%`);
          }
          break;
        case 'filename':
          conditions.push('filename LIKE ?'); params.push(`%${c.value}%`); break;
      }
    }
    return { conditions, params };
  }

  close() {
    if (this.db) { this.db.close(); this.db = null; }
  }
}

module.exports = VideoDatabase;
