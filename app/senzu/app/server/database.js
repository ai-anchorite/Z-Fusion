// Senzu Gallery — SQLite image metadata database.
// Fingerprint-based indexing, full search engine, tags, soft-delete/trash,
// folders, settings and saved searches. Ported/simplified from Breadboard.

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const sizeOf = require('image-size');

// Routine gallery logging is silenced by default so it never interferes with
// the launcher's terminal URL-capture. Set SENZU_GALLERY_LOG=1 to enable.
const glog = process.env.SENZU_GALLERY_LOG === '1' ? (...a) => console.log(...a) : () => {};

const SAMPLE_SIZE = 64 * 1024; // 64KB head + tail sampling

class GalleryDatabase {
  constructor(dbPath) {
    this.dbPath = dbPath;
    this.db = null;
    this.init();
  }

  init() {
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS images (
        fingerprint TEXT PRIMARY KEY,
        file_path TEXT NOT NULL,
        filename TEXT NOT NULL,
        root_path TEXT NOT NULL,
        subfolder TEXT,

        agent TEXT DEFAULT 'comfyui',
        prompt TEXT,
        negative_prompt TEXT,
        sampler TEXT,
        scheduler TEXT,
        steps INTEGER,
        cfg_scale REAL,
        seed INTEGER,
        model_name TEXT,
        clip_name TEXT,
        vae_name TEXT,
        loras TEXT,
        process_params TEXT,

        width INTEGER,
        height INTEGER,
        size INTEGER,
        btime INTEGER NOT NULL,
        mtime INTEGER NOT NULL,
        indexed_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE COLLATE NOCASE
      );

      CREATE TABLE IF NOT EXISTS image_tags (
        fingerprint TEXT NOT NULL,
        tag_id INTEGER NOT NULL,
        added_at INTEGER NOT NULL,
        PRIMARY KEY (fingerprint, tag_id),
        FOREIGN KEY (fingerprint) REFERENCES images(fingerprint) ON DELETE CASCADE,
        FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS folders (
        path TEXT PRIMARY KEY,
        added_at INTEGER NOT NULL,
        recursive INTEGER NOT NULL DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        val TEXT
      );

      CREATE TABLE IF NOT EXISTS favorites (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        query TEXT NOT NULL,
        label TEXT,
        is_global INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS trash (
        fingerprint TEXT PRIMARY KEY,
        original_path TEXT NOT NULL,
        trash_path TEXT NOT NULL,
        deleted_at INTEGER NOT NULL,
        metadata TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_images_path ON images(file_path);
      CREATE INDEX IF NOT EXISTS idx_images_root ON images(root_path);
      CREATE INDEX IF NOT EXISTS idx_images_model ON images(model_name);
      CREATE INDEX IF NOT EXISTS idx_images_btime ON images(btime);
      CREATE INDEX IF NOT EXISTS idx_image_tags_tag ON image_tags(tag_id);
    `);

    // Clean up orphaned FTS5 artifacts from a previous broken build.
    try {
      this.db.exec(`
        DROP TRIGGER IF EXISTS images_ai;
        DROP TRIGGER IF EXISTS images_ad;
        DROP TRIGGER IF EXISTS images_au;
        DROP TABLE IF EXISTS images_fts;
      `);
    } catch (err) {
      if (err.message && err.message.includes('malformed')) {
        console.error('[Gallery] The image database is corrupted and must be recreated.');
        console.error('[Gallery] Delete ' + this.dbPath + ' and restart Senzu.');
      }
    }

    this._stmts = {
      getByFingerprint: this.db.prepare('SELECT * FROM images WHERE fingerprint = ?'),
      getByPath: this.db.prepare('SELECT * FROM images WHERE file_path = ?'),
      getTags: this.db.prepare(`
        SELECT t.name FROM tags t
        INNER JOIN image_tags it ON it.tag_id = t.id
        WHERE it.fingerprint = ?
        ORDER BY t.name COLLATE NOCASE
      `),
      insertTag: this.db.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)'),
      getTagByName: this.db.prepare('SELECT id FROM tags WHERE name = ? COLLATE NOCASE'),
      insertImageTag: this.db.prepare('INSERT OR IGNORE INTO image_tags (fingerprint, tag_id, added_at) VALUES (?, ?, ?)'),
      deleteImageTag: this.db.prepare('DELETE FROM image_tags WHERE fingerprint = ? AND tag_id = ?'),
      tagUsageCount: this.db.prepare('SELECT COUNT(*) as count FROM image_tags WHERE tag_id = ?'),
      deleteOrphanTag: this.db.prepare('DELETE FROM tags WHERE id = ?'),
      deleteImage: this.db.prepare('DELETE FROM images WHERE fingerprint = ?'),
      count: this.db.prepare('SELECT COUNT(*) as count FROM images'),
    };

    glog('[Gallery] Database initialized:', this.dbPath);
  }

  // --- Fingerprinting ---

  async computeFingerprint(filePath, stats) {
    const size = Number(stats.size || 0);
    const createdMs = Math.round(stats.birthtimeMs || stats.ctimeMs || stats.mtimeMs || 0);
    const hash = crypto.createHash('sha256');

    let handle;
    try {
      if (size > 0) {
        handle = await fs.promises.open(filePath, 'r');
        const sampleSize = Math.min(SAMPLE_SIZE, size);

        const headBuf = Buffer.alloc(sampleSize);
        await handle.read(headBuf, 0, sampleSize, 0);
        hash.update(headBuf);

        if (size > sampleSize) {
          const tailBuf = Buffer.alloc(sampleSize);
          await handle.read(tailBuf, 0, sampleSize, Math.max(0, size - sampleSize));
          hash.update(tailBuf);
        } else {
          hash.update(headBuf);
        }
      }
    } catch (err) {
      hash.update(String(err.message || 'error'));
    } finally {
      if (handle) {
        try { await handle.close(); } catch (_) {}
      }
    }

    hash.update(Buffer.from(String(size)));
    hash.update(Buffer.from(String(createdMs)));

    return hash.digest('hex');
  }

  // --- Indexing ---

  async indexImage(filePath, rootPath, metadata, stats) {
    const fingerprint = await this.computeFingerprint(filePath, stats);
    const filename = path.basename(filePath);
    const now = Date.now();

    // Always read real dimensions from the file header — workflow metadata can
    // record tile/reference sizes instead of the true output dimensions.
    let width = null;
    let height = null;
    try {
      const dims = sizeOf(filePath);
      width = dims.width;
      height = dims.height;
    } catch (e) {
      const mw = parseInt(metadata.width, 10);
      const mh = parseInt(metadata.height, 10);
      width = Number.isFinite(mw) ? mw : null;
      height = Number.isFinite(mh) ? mh : null;
    }

    const dirName = path.dirname(filePath);
    const relative = path.relative(rootPath, dirName);
    const subfolder = (relative && relative !== '.') ? relative : null;

    const stmt = this.db.prepare(`
      INSERT INTO images (
        fingerprint, file_path, filename, root_path, subfolder,
        agent, prompt, negative_prompt, sampler, scheduler, steps, cfg_scale, seed,
        model_name, clip_name, vae_name, loras, process_params,
        width, height, size, btime, mtime, indexed_at
      ) VALUES (
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?
      )
      ON CONFLICT(fingerprint) DO UPDATE SET
        file_path = excluded.file_path,
        filename = excluded.filename,
        subfolder = excluded.subfolder,
        agent = COALESCE(excluded.agent, images.agent),
        prompt = COALESCE(excluded.prompt, images.prompt),
        negative_prompt = COALESCE(excluded.negative_prompt, images.negative_prompt),
        sampler = COALESCE(excluded.sampler, images.sampler),
        scheduler = COALESCE(excluded.scheduler, images.scheduler),
        steps = COALESCE(excluded.steps, images.steps),
        cfg_scale = COALESCE(excluded.cfg_scale, images.cfg_scale),
        seed = COALESCE(excluded.seed, images.seed),
        model_name = COALESCE(excluded.model_name, images.model_name),
        clip_name = COALESCE(excluded.clip_name, images.clip_name),
        vae_name = COALESCE(excluded.vae_name, images.vae_name),
        loras = COALESCE(excluded.loras, images.loras),
        process_params = COALESCE(excluded.process_params, images.process_params),
        width = COALESCE(excluded.width, images.width),
        height = COALESCE(excluded.height, images.height),
        mtime = excluded.mtime,
        indexed_at = excluded.indexed_at
    `);

    const cleanStr = (v) => (v != null && v !== '' && typeof v !== 'object') ? String(v) : null;
    const cleanInt = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; };
    const cleanFloat = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };

    stmt.run(
      fingerprint, filePath, filename, rootPath, subfolder,
      metadata.agent || 'comfyui',
      cleanStr(metadata.prompt),
      cleanStr(metadata.negative_prompt),
      cleanStr(metadata.sampler),
      cleanStr(metadata.scheduler),
      cleanInt(metadata.steps),
      cleanFloat(metadata.cfg_scale),
      cleanInt(metadata.seed),
      cleanStr(metadata.model_name),
      cleanStr(metadata.clip_name),
      cleanStr(metadata.vae_name),
      metadata.loras || null,
      metadata.process_params || null,
      width,
      height,
      Number(stats.size || 0),
      Math.floor(stats.birthtimeMs || stats.ctimeMs || 0),
      Math.floor(stats.mtimeMs || 0),
      now
    );

    return this.getImage(fingerprint);
  }

  // --- Retrieval ---

  getImage(fingerprint) {
    const image = this._stmts.getByFingerprint.get(fingerprint);
    if (!image) return null;
    const tags = this.getImageTags(fingerprint);
    return { ...image, tags, id: image.fingerprint };
  }

  getImageByPath(filePath) {
    const image = this._stmts.getByPath.get(filePath);
    if (!image) return null;
    return this.getImage(image.fingerprint);
  }

  getImageTags(fingerprint) {
    return this._stmts.getTags.all(fingerprint).map(r => r.name);
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
        this._stmts.insertTag.run(trimmed);
        const tag = this._stmts.getTagByName.get(trimmed);
        if (tag) {
          for (const fp of fingerprints) {
            this._stmts.insertImageTag.run(fp, tag.id, now);
          }
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
        const tag = this._stmts.getTagByName.get(trimmed);
        if (!tag) continue;
        for (const fp of fingerprints) {
          this._stmts.deleteImageTag.run(fp, tag.id);
        }
        if (this._stmts.tagUsageCount.get(tag.id).count === 0) {
          this._stmts.deleteOrphanTag.run(tag.id);
        }
      }
    });
    txn();
  }

  getAllTags() {
    return this.db.prepare(`
      SELECT t.name, COUNT(it.fingerprint) as count
      FROM tags t
      LEFT JOIN image_tags it ON it.tag_id = t.id
      GROUP BY t.id
      ORDER BY t.name COLLATE NOCASE
    `).all();
  }

  // --- Soft Delete / Trash ---

  softDelete(fingerprints, trashDir) {
    if (!fs.existsSync(trashDir)) {
      fs.mkdirSync(trashDir, { recursive: true });
    }

    const now = Date.now();
    const results = [];

    const txn = this.db.transaction(() => {
      for (const fp of fingerprints) {
        const image = this._stmts.getByFingerprint.get(fp);
        if (!image) continue;

        let filename = path.basename(image.file_path);
        let trashPath = path.join(trashDir, filename);

        if (fs.existsSync(trashPath)) {
          const ext = path.extname(filename);
          const base = path.basename(filename, ext);
          trashPath = path.join(trashDir, `${base}_${now}${ext}`);
        }

        try {
          fs.renameSync(image.file_path, trashPath);
        } catch (err) {
          try {
            fs.copyFileSync(image.file_path, trashPath);
            fs.unlinkSync(image.file_path);
          } catch (copyErr) {
            console.error('[Gallery] Failed to trash file:', image.file_path, copyErr.message);
            continue;
          }
        }

        const metadata = JSON.stringify(this.getImage(fp));
        this.db.prepare(`
          INSERT OR REPLACE INTO trash (fingerprint, original_path, trash_path, deleted_at, metadata)
          VALUES (?, ?, ?, ?, ?)
        `).run(fp, image.file_path, trashPath, now, metadata);

        this._stmts.deleteImage.run(fp);
        results.push({ fingerprint: fp, trashPath });
      }
    });
    txn();

    return results;
  }

  restoreFromTrash(fingerprints) {
    const results = [];
    const txn = this.db.transaction(() => {
      for (const fp of fingerprints) {
        const trashRecord = this.db.prepare('SELECT * FROM trash WHERE fingerprint = ?').get(fp);
        if (!trashRecord) continue;

        try {
          const originalDir = path.dirname(trashRecord.original_path);
          if (!fs.existsSync(originalDir)) fs.mkdirSync(originalDir, { recursive: true });
          fs.renameSync(trashRecord.trash_path, trashRecord.original_path);
        } catch (err) {
          try {
            const originalDir = path.dirname(trashRecord.original_path);
            if (!fs.existsSync(originalDir)) fs.mkdirSync(originalDir, { recursive: true });
            fs.copyFileSync(trashRecord.trash_path, trashRecord.original_path);
            fs.unlinkSync(trashRecord.trash_path);
          } catch (copyErr) {
            console.error('[Gallery] Failed to restore file:', trashRecord.original_path, copyErr.message);
            continue;
          }
        }

        this.db.prepare('DELETE FROM trash WHERE fingerprint = ?').run(fp);
        results.push({ fingerprint: fp, restoredTo: trashRecord.original_path });
      }
    });
    txn();

    return results;
  }

  getTrash() {
    return this.db.prepare('SELECT * FROM trash ORDER BY deleted_at DESC').all();
  }

  emptyTrash() {
    const items = this.getTrash();
    for (const item of items) {
      try {
        if (fs.existsSync(item.trash_path)) fs.unlinkSync(item.trash_path);
      } catch (err) {
        console.error('[Gallery] Failed to permanently delete:', item.trash_path, err.message);
      }
    }
    this.db.prepare('DELETE FROM trash').run();
    return items.length;
  }

  removeByPath(filePath) {
    const image = this._stmts.getByPath.get(filePath);
    if (!image) return null;
    this._stmts.deleteImage.run(image.fingerprint);
    return image.fingerprint;
  }

  // --- Search ---
  // Query syntax: free text (prompt), tag:x, -tag:x, model_name:x, loras:x,
  // width:>1024, steps:>=30, before:DATE, after:DATE, etc.

  search(queryString, options = {}) {
    const { sort = 'btime', direction = -1, offset = 0, limit = 100 } = options;

    if (!queryString || !queryString.trim()) {
      return this._getAllSorted(sort, direction, offset, limit);
    }

    const parsed = this._parseQuery(queryString);
    const { conditions, params } = this._buildSQL(parsed);

    const orderDir = direction < 0 ? 'DESC' : 'ASC';
    const orderExpr = this._sortExpression(sort);

    let sql = `SELECT i.*, GROUP_CONCAT(t.name) as tag_list
      FROM images i
      LEFT JOIN image_tags it ON it.fingerprint = i.fingerprint
      LEFT JOIN tags t ON t.id = it.tag_id`;

    if (conditions.length > 0) {
      sql += ` WHERE ${conditions.join(' AND ')}`;
    }

    sql += ` GROUP BY i.fingerprint`;

    const havingClauses = parsed.filter(p => p.type === 'tag' || p.type === '-tag');
    if (havingClauses.length > 0) {
      const havings = [];
      for (const clause of havingClauses) {
        if (clause.type === 'tag') {
          havings.push(`SUM(CASE WHEN t.name = ? COLLATE NOCASE THEN 1 ELSE 0 END) > 0`);
          params.push(clause.value);
        } else if (clause.type === '-tag') {
          havings.push(`SUM(CASE WHEN t.name = ? COLLATE NOCASE THEN 1 ELSE 0 END) = 0`);
          params.push(clause.value);
        }
      }
      sql += ` HAVING ${havings.join(' AND ')}`;
    }

    sql += ` ORDER BY ${orderExpr} ${orderDir}`;

    const countSQL = `SELECT COUNT(*) as count FROM (${sql})`;
    const count = this.db.prepare(countSQL).get(...params).count;

    sql += ` LIMIT ? OFFSET ?`;
    params.push(limit, offset * limit);

    const rows = this.db.prepare(sql).all(...params);

    return {
      results: rows.map(row => this._rowToResult(row)),
      count,
      offset,
      limit,
    };
  }

  _getAllSorted(sort, direction, offset, limit) {
    const orderDir = direction < 0 ? 'DESC' : 'ASC';
    const orderExpr = this._sortExpression(sort);
    const count = this.getCount();

    const rows = this.db.prepare(`
      SELECT i.*, GROUP_CONCAT(t.name) as tag_list
      FROM images i
      LEFT JOIN image_tags it ON it.fingerprint = i.fingerprint
      LEFT JOIN tags t ON t.id = it.tag_id
      GROUP BY i.fingerprint
      ORDER BY ${orderExpr} ${orderDir}
      LIMIT ? OFFSET ?
    `).all(limit, offset * limit);

    return {
      results: rows.map(row => this._rowToResult(row)),
      count,
      offset,
      limit,
    };
  }

  _rowToResult(row) {
    const { tag_list, ...rest } = row;
    return {
      ...rest,
      tags: tag_list ? tag_list.split(',') : [],
      id: row.fingerprint,
    };
  }

  _sortExpression(col) {
    const computed = { 'resolution': '(COALESCE(i.width, 0) * COALESCE(i.height, 0))' };
    if (computed[col]) return computed[col];
    const allowed = ['btime', 'filename', 'model_name', 'size'];
    if (allowed.includes(col)) return `i.${col}`;
    return 'i.btime';
  }

  _parseQuery(queryString) {
    const tokens = [];
    const re = /(-?(?:[\w]+)?:?)?"([^"]+)"|(\S+)/g;
    let match;
    while ((match = re.exec(queryString)) !== null) {
      if (match[1] && match[2]) {
        tokens.push(match[1] + match[2]);
      } else if (match[3]) {
        tokens.push(match[3]);
      }
    }

    const parsed = [];
    const numericFields = ['width', 'height', 'seed', 'cfg_scale', 'steps'];
    const stringFields = [
      'model_name', 'clip_name', 'vae_name', 'sampler', 'scheduler',
      'loras', 'agent', 'root_path', 'subfolder', 'file_path', 'filename', 'negative_prompt'
    ];

    for (const token of tokens) {
      if (token.startsWith('before:')) {
        parsed.push({ type: 'before', value: token.slice(7) });
      } else if (token.startsWith('after:')) {
        parsed.push({ type: 'after', value: token.slice(6) });
      } else if (token.startsWith('-tag:')) {
        parsed.push({ type: '-tag', value: token.slice(5) });
      } else if (token.startsWith('tag:')) {
        parsed.push({ type: 'tag', value: token.slice(4) });
      } else if (token.startsWith('-:')) {
        parsed.push({ type: '-prompt', value: token.slice(2) });
      } else if (this._parseNumeric(token, numericFields, parsed)) {
        // handled inside _parseNumeric
      } else if (this._parseField(token, stringFields, parsed)) {
        // handled inside _parseField
      } else {
        parsed.push({ type: 'prompt', value: token });
      }
    }

    return parsed;
  }

  _parseField(token, stringFields, parsed) {
    for (const field of stringFields) {
      const negPrefix = `-${field}:`;
      const posPrefix = `${field}:`;
      if (token.startsWith(negPrefix)) {
        parsed.push({ type: '-field', field, value: token.slice(negPrefix.length) });
        return true;
      }
      if (token.startsWith(posPrefix)) {
        parsed.push({ type: 'field', field, op: 'LIKE', value: token.slice(posPrefix.length) });
        return true;
      }
    }
    return false;
  }

  _parseNumeric(token, numericFields, parsed) {
    for (const field of numericFields) {
      const prefixOps = [
        { prefix: `+=${field}:`, op: '>=' },
        { prefix: `-=${field}:`, op: '<=' },
        { prefix: `+${field}:`, op: '>' },
        { prefix: `-${field}:`, op: '<' },
        { prefix: `${field}:>=`, op: '>=' },
        { prefix: `${field}:<=`, op: '<=' },
        { prefix: `${field}:>`, op: '>' },
        { prefix: `${field}:<`, op: '<' },
        { prefix: `${field}:`, op: '=' },
      ];

      for (const { prefix, op } of prefixOps) {
        if (token.startsWith(prefix)) {
          const val = token.slice(prefix.length);
          if (val && !isNaN(val)) {
            parsed.push({ type: 'numeric', field, op, value: parseFloat(val) });
            return true;
          }
        }
      }
    }
    return false;
  }

  _buildSQL(parsed) {
    const conditions = [];
    const params = [];

    for (const clause of parsed) {
      switch (clause.type) {
        case 'before':
          conditions.push('i.btime <= ?');
          params.push(new Date(clause.value).getTime());
          break;
        case 'after':
          conditions.push('i.btime >= ?');
          params.push(new Date(clause.value).getTime());
          break;
        case 'prompt':
          // Strip common punctuation from the prompt before word-boundary
          // matching so e.g. "comma" matches "comma," in the source text.
          // The surrounding spaces still enforce whole-word matching.
          conditions.push(`(' ' || REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(i.prompt, ',', ' '), '.', ' '), ':', ' '), ';', ' '), '!', ' '), '?', ' ') || ' ' LIKE ?)`);
          params.push(`% ${clause.value} %`);
          break;
        case '-prompt':
          conditions.push(`(i.prompt IS NULL OR ' ' || REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(i.prompt, ',', ' '), '.', ' '), ':', ' '), ';', ' '), '!', ' '), '?', ' ') || ' ' NOT LIKE ?)`);
          params.push(`% ${clause.value} %`);
          break;
        case 'field':
          if (clause.field === 'subfolder' || clause.field === 'root_path') {
            conditions.push(`i.${clause.field} = ?`);
            params.push(clause.value);
          } else {
            conditions.push(`i.${clause.field} LIKE ?`);
            params.push(`%${clause.value}%`);
          }
          break;
        case '-field':
          if (clause.field === 'subfolder' || clause.field === 'root_path') {
            conditions.push(`(i.${clause.field} IS NULL OR i.${clause.field} != ?)`);
            params.push(clause.value);
          } else {
            conditions.push(`(i.${clause.field} IS NULL OR i.${clause.field} NOT LIKE ?)`);
            params.push(`%${clause.value}%`);
          }
          break;
        case 'numeric':
          conditions.push(`i.${clause.field} ${clause.op} ?`);
          params.push(clause.value);
          break;
      }
    }

    return { conditions, params };
  }

  // --- Folders ---

  addFolder(folderPath, recursive = true) {
    this.db.prepare('INSERT OR IGNORE INTO folders (path, recursive, added_at) VALUES (?, ?, ?)')
      .run(folderPath, recursive ? 1 : 0, Date.now());
  }

  removeFolder(folderPath) {
    this.db.prepare('DELETE FROM folders WHERE path = ?').run(folderPath);
    this.db.prepare('DELETE FROM images WHERE root_path = ?').run(folderPath);
  }

  getFolders() {
    return this.db.prepare('SELECT * FROM folders ORDER BY added_at').all();
  }

  getFolderBookmarks() {
    const folders = this.getFolders();
    const counts = this.db.prepare(`
      SELECT root_path, COUNT(*) as count FROM images
      WHERE root_path IS NOT NULL AND root_path != ''
      GROUP BY root_path
    `).all();
    const subfolders = this.db.prepare(`
      SELECT root_path, subfolder, COUNT(*) as count FROM images
      WHERE root_path IS NOT NULL AND root_path != ''
        AND subfolder IS NOT NULL AND subfolder != ''
      GROUP BY root_path, subfolder
      ORDER BY root_path ASC, subfolder ASC
    `).all();

    const countByRoot = new Map(counts.map(row => [row.root_path, row.count]));
    const subfoldersByRoot = new Map();
    for (const row of subfolders) {
      if (!subfoldersByRoot.has(row.root_path)) subfoldersByRoot.set(row.root_path, []);
      subfoldersByRoot.get(row.root_path).push({ subfolder: row.subfolder, count: row.count });
    }

    return folders.map(folder => ({
      ...folder,
      name: path.basename(folder.path) || folder.path,
      recursive: folder.recursive !== 0,
      count: countByRoot.get(folder.path) || 0,
      subfolders: subfoldersByRoot.get(folder.path) || [],
    }));
  }

  // --- Settings ---

  getSetting(key) {
    const row = this.db.prepare('SELECT val FROM settings WHERE key = ?').get(key);
    return row ? row.val : null;
  }

  setSetting(key, val) {
    this.db.prepare(`
      INSERT INTO settings (key, val) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET val = excluded.val
    `).run(key, String(val));
  }

  // --- Favorites (saved searches) ---

  addFavorite(query, label, isGlobal = false) {
    const info = this.db.prepare(`
      INSERT INTO favorites (query, label, is_global, created_at) VALUES (?, ?, ?, ?)
    `).run(query, label || null, isGlobal ? 1 : 0, Date.now());
    return info.lastInsertRowid;
  }

  removeFavorite(id) {
    this.db.prepare('DELETE FROM favorites WHERE id = ?').run(id);
  }

  getFavorites() {
    return this.db.prepare('SELECT * FROM favorites ORDER BY created_at').all();
  }

  // --- Lifecycle ---

  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

module.exports = GalleryDatabase;
