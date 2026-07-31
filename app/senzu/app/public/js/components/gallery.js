// Senzu Gallery — Alpine.js component.
// Grid rendering (manual innerHTML for performance), keyword search, live
// Socket.IO updates, fullscreen viewer with zoom/pan + metadata hyperfilters,
// multi-select, tagging and soft-delete/trash.

document.addEventListener('alpine:init', () => {
  Alpine.data('gallery', () => ({
    // --- Reactive state ---
    mediaType: 'images',   // 'images' | 'videos'
    items: [],
    searchQuery: '',
    sortKey: 'btime',
    sortDir: -1,
    loading: false,
    hasMore: true,
    offset: 0,
    total: 0,
    tags: [],
    imageBookmarks: [],
    videoBookmarks: [],
    imageFolders: [],
    videoFolders: [],
    foldersOpen: false,
    newFolderRecursive: true,
    folderPathInput: '',
    pickerUnavailable: false,
    connecting: false,
    openChip: null,
    selectedFps: [],
    settingsOpen: false,
    trashItems: [],
    reindexing: false,
    settings: {
      cardWidth: 240,
      layout: 'grid',      // 'masonry' | 'grid'
      showMeta: true,
      imageLimit: 100,
      showBookmarks: true,
      confirmDelete: true,
      hidePanel: false,        // start viewer with info panel hidden
      slideshowInterval: 3000  // ms
    },
    // Video-specific state
    videoVolume: 50,
    videoFps: 30,
    crop: {
      active: false,
      x: 0, y: 0, w: 0, h: 0,
      dragging: false,
      handle: null,
      startSX: 0, startSY: 0,
      startIX: 0, startIY: 0,
      origX: 0, origY: 0, origW: 0, origH: 0,
      aspectLocked: false,
      aspectRatio: 1,
    },
    jobs: [],
    queueOpen: false,
    outputViewerOpen: false,
    outputViewerIndex: 0,
    lastSavedOutput: null,
    scan: { active: false, current: 0, total: 0 },
    initialized: false,

    // --- Non-reactive viewer state ---
    _viewerIndex: 0,
    _zoom: 1,
    _panX: 0,
    _panY: 0,
    _isPanning: false,
    _slideshowTimer: null,
    _keyHandler: null,
    _panelHidden: false,
    _searchTimer: null,
    _appSaveFolder: '',
    _masonryCols: null,
    _masonryLastCount: 0,
    _masonryResizeObserver: null,
    socket: null,

    // =========================================================
    // Init
    // =========================================================
    async init() {
      if (this.initialized) return;
      this.initialized = true;

      // Restore persisted view settings.
      try {
        const saved = localStorage.getItem('senzu-gallery-settings');
        if (saved) this.settings = { ...this.settings, ...JSON.parse(saved) };
      } catch (_) {}
      this.applySettings();

      try {
        const appSettings = await api.getSettings();
        this._appSaveFolder = (appSettings && appSettings.save_folder) || '';
      } catch (_) { this._appSaveFolder = ''; }

      await this.refreshTags();
      await this.loadImageBookmarks();
      await this.loadVideoBookmarks();
      await this.loadImageFolders();
      await this.loadVideoFolders();
      await this.search(false);

      this.connectSocket();
      this.attachGridHandlers();
    },

    connectSocket() {
      if (typeof io === 'undefined') {
        console.warn('[Gallery] socket.io client not loaded — live updates disabled');
        return;
      }
      try {
        this.socket = io();
        this.socket.on('gallery-new', (image) => this.onSocketNew(image));
        this.socket.on('gallery-update', (image) => this.onSocketUpdate(image));
        this.socket.on('gallery-remove', (data) => this.onSocketRemove(data.fingerprint));
        this.socket.on('gallery-progress', (data) => this.onSocketProgress(data));
        this.socket.on('gallery-count', (data) => { if (data && data.count != null) this.total = data.count; });
        this.socket.on('job-started', (job) => this._onJobStarted(job));
        this.socket.on('job-completed', (job) => this._onJobCompleted(job));
        this.socket.on('job-error', (data) => this._onJobError(data));
        // Video-specific events
        this.socket.on('video-new', (video) => { if (this.mediaType === 'videos') this.onSocketNew(video); });
        this.socket.on('video-remove', (data) => { if (this.mediaType === 'videos') this.onSocketRemove(data.fingerprint); });
        this.socket.on('video-progress', (data) => { if (this.mediaType === 'videos') this.onSocketProgress(data); });
      } catch (e) {
        console.warn('[Gallery] socket connection failed:', e.message);
      }
    },

    // =========================================================
    // Settings
    // =========================================================
    applySettings() {
      const root = this.$root;
      if (root) {
        root.style.setProperty('--gallery-card-width', this.settings.cardWidth + 'px');
        root.classList.toggle('layout-grid', this.settings.layout === 'grid');
        root.classList.toggle('layout-masonry', this.settings.layout === 'masonry');
        root.classList.toggle('hide-meta', !this.settings.showMeta);
      }
      if (this.settings.layout === 'masonry') {
        this._layoutMasonry(true);
      } else {
        this._teardownMasonry();
      }
    },

    saveSettings() {
      try { localStorage.setItem('senzu-gallery-settings', JSON.stringify(this.settings)); } catch (_) {}
      this.applySettings();
    },

    async reindexImages() {
      if (this.reindexing) return;
      this.reindexing = true;
      try {
        await api.gallery.reindex();
        await this.refreshTags();
        await this.search(false);
      } catch (e) {
        console.error('[Gallery] reindex failed:', e);
        alert('Re-index failed: ' + e.message);
      } finally {
        this.reindexing = false;
      }
    },

    // =========================================================
    // Search & rendering
    // =========================================================
    buildQueryParams(offset) {
      return {
        q: this.searchQuery.trim(),
        sort: this.sortKey,
        direction: this.sortDir,
        offset,
        limit: parseInt(this.settings.imageLimit, 10) || 100
      };
    },

    debouncedSearch() {
      clearTimeout(this._searchTimer);
      this._searchTimer = setTimeout(() => this.search(false), 300);
    },

    async search(append = false) {
      if (this.loading) return;
      this.loading = true;
      const nextOffset = append ? this.offset + 1 : 0;
      try {
        const params = this.buildQueryParams(nextOffset);
        let res;
        if (this.mediaType === 'videos') {
          res = await api.gallery.videoSearch(params);
        } else {
          res = await api.gallery.search(params);
        }
        const results = res.results || [];
        this.total = res.count || 0;
        this.offset = nextOffset;
        this.hasMore = (this.offset + 1) * (res.limit || 100) < this.total;

        if (append) {
          this.items = this.items.concat(results);
        } else {
          this.items = results;
        }
        this.renderGrid(append ? results : null);
      } catch (e) {
        console.error('[Gallery] search failed:', e);
      } finally {
        this.loading = false;
      }
    },

    async loadMore() {
      if (this.hasMore && !this.loading) await this.search(true);
    },

    setSort(key) {
      if (this.sortKey === key) {
        this.sortDir = this.sortDir === -1 ? 1 : -1;
      } else {
        this.sortKey = key;
        this.sortDir = -1;
      }
      this.search(false);
    },

    clearSearch() {
      this.searchQuery = '';
      this.search(false);
    },

    switchMediaType(type) {
      if (this.mediaType === type) return;
      this.mediaType = type;
      this.searchQuery = '';
      this.sortKey = 'btime';
      this.sortDir = -1;
      this.items = [];
      this.total = 0;
      this.offset = 0;
      this.hasMore = true;
      this.selectedFps = [];
      this.tags = [];
      this.refreshTags();
      this.search(false);
    },

    // Refresh: clear the search and reload the default view (Breadboard-style).
    refresh() {
      this.searchQuery = '';
      this.search(false);
    },

    // --- Favorites quick-filter (special `favorite` tag) ---
    get isFavoritesActive() {
      return this.searchQuery.trim() === 'tag:favorite';
    },

    toggleFavorites() {
      this.searchQuery = this.isFavoritesActive ? '' : 'tag:favorite';
      this.search(false);
    },

    // --- Bookmarks (saved searches) ---
    async loadImageBookmarks() {
      try { this.imageBookmarks = await api.gallery.favorites(); } catch (_) { this.imageBookmarks = []; }
    },

    async loadVideoBookmarks() {
      try { this.videoBookmarks = await api.gallery.favorites(); } catch (_) { this.videoBookmarks = []; }
    },

    async saveBookmark() {
      const q = this.searchQuery.trim();
      if (!q) { alert('Enter a search or filter first, then bookmark it.'); return; }
      const label = prompt('Bookmark label:', q);
      if (label === null) return;
      await api.gallery.addFavorite(q, label.trim() || q, false);
      await this.loadImageBookmarks();
    },

    applyBookmark(query) {
      this.searchQuery = query;
      this.search(false);
    },

    async deleteBookmark(id) {
      await api.gallery.removeFavorite(id);
      await this.loadImageBookmarks();
    },

    // --- Connected folders ---
    async loadImageFolders() {
      try { this.imageFolders = await api.gallery.folders(); } catch (_) { this.imageFolders = []; }
    },

    async loadVideoFolders() {
      try { this.videoFolders = await api.gallery.videoFolders(); } catch (_) { this.videoFolders = []; }
    },

    openFolders() {
      this.foldersOpen = !this.foldersOpen;
      if (this.foldersOpen) {
        if (this.mediaType === 'videos') this.loadVideoFolders();
        else this.loadImageFolders();
      }
    },

    async connectFolder() {
      if (this.connecting) return;
      this.connecting = true;
      try {
        const res = await api.gallery.pickFolder();
        if (res && res.path) {
          await this.addFolderPath(res.path);
        } else if (res && res.unavailable) {
          this.pickerUnavailable = true;
        }
      } catch (e) {
        console.error('[Gallery] pick folder failed:', e);
        this.pickerUnavailable = true;
      } finally {
        this.connecting = false;
      }
    },

    async addFolderPath(p) {
      const folderPath = (p || this.folderPathInput || '').trim();
      if (!folderPath) return;
      this.connecting = true;
      try {
        let res;
        if (this.mediaType === 'videos') {
          res = await api.gallery.videoAddFolder(folderPath, this.newFolderRecursive);
          if (res && res.folders) this.videoFolders = res.folders;
        } else {
          res = await api.gallery.addFolder(folderPath, this.newFolderRecursive);
          if (res && res.folders) this.imageFolders = res.folders;
        }
        this.folderPathInput = '';
        await this.search(false);
      } catch (e) {
        alert('Could not connect folder: ' + e.message);
      } finally {
        this.connecting = false;
      }
    },

    async removeFolder(folderPath) {
      if (!confirm('Disconnect this folder and remove its media from the gallery index?\n\nYour files are NOT deleted.')) return;
      try {
        let res;
        if (this.mediaType === 'videos') {
          res = await api.gallery.videoRemoveFolder(folderPath);
          if (res && res.folders) this.videoFolders = res.folders;
        } else {
          res = await api.gallery.removeFolder(folderPath);
          if (res && res.folders) this.imageFolders = res.folders;
        }
        // Clear the grid directly — bypassing search() avoids the loading
        // guard which would drop us if a prior search is still in-flight.
        this.searchQuery = '';
        this.items = [];
        this.total = 0;
        this.offset = 0;
        this.hasMore = true;
        this.renderGrid(null);
      } catch (e) {
        alert('Could not remove folder: ' + e.message);
      }
    },

    async reindexFolder(folderPath) {
      if (this.mediaType === 'videos') return;
      try {
        await api.gallery.reindexFolder(folderPath);
        await this.loadImageFolders();
        this.searchQuery = '';
        this.items = [];
        this.total = 0;
        this.offset = 0;
        this.hasMore = true;
        this.renderGrid(null);
      } catch (e) {
        console.error('[Gallery] reindex folder failed:', e);
      }
    },

    // --- Folder chips (bookmark bar) ---
    toggleChip(key) {
      this.openChip = this.openChip === key ? null : key;
    },

    filterByFolder(f) {
      this.searchQuery = `root_path:"${f.path}"`;
      this.openChip = null;
      this.search(false);
    },

    filterBySubfolder(f, sub) {
      this.searchQuery = `root_path:"${f.path}" subfolder:"${sub}"`;
      this.openChip = null;
      this.search(false);
    },

    escapeHTML(str) {
      if (str == null) return '';
      return String(str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    },

    cardHTML(item) {
      if (this.mediaType === 'videos') return this.videoCardHTML(item);
      const tags = item.tags || [];
      const isFav = tags.includes('favorite');
      const favIcon = isFav ? 'fa-solid fa-heart' : 'fa-regular fa-heart';
      const selected = this.selectedFps.includes(item.fingerprint) ? ' selected' : '';
      const model = item.model_name ? `<span class="gallery-card-badge">${this.escapeHTML(item.model_name)}</span>` : '';
      const promptText = item.prompt ? this.escapeHTML(item.prompt.slice(0, 140)) : '';
      const promptHTML = promptText ? `<div class="gallery-hover-prompt">${promptText}</div>` : '';
      const ar = (item.width && item.height) ? (item.width / item.height) : '';
      const src = item.thumb || item.src;
      const fullSrc = item.src;

      return `<div class="gallery-card${selected}" data-fp="${item.fingerprint}" data-ar="${ar}">
        <div class="gallery-grab">
          <button class="g-btn g-fav" data-fav="${isFav}" title="Favorite"><i class="${favIcon}"></i></button>
          <div class="gallery-grab-right">
            <button class="g-btn g-folder" title="Open containing folder"><i class="fa-solid fa-folder-open"></i></button>
            <button class="g-btn g-trash" title="Move to trash"><i class="fa-regular fa-trash-can"></i></button>
          </div>
        </div>
        <div class="gallery-card-imgwrap"${ar ? ` style="--ar:${ar}"` : ''}>
          <img loading="lazy" src="${src}" data-full="${fullSrc}" alt="">
        </div>
        ${model}
        ${promptHTML}
      </div>`;
    },

    videoCardHTML(item) {
      const tags = item.tags || [];
      const isFav = tags.includes('favorite');
      const favIcon = isFav ? 'fa-solid fa-heart' : 'fa-regular fa-heart';
      const selected = this.selectedFps.includes(item.fingerprint) ? ' selected' : '';
      const videoUrl = item.src || '/api/gallery/videos/file/' + encodeURIComponent(item.fingerprint);
      const thumbUrl = item.thumb || '';
      const dur = item.duration ? this.formatDuration(item.duration) : '';
      const hasThumb = !!item.thumbnail_path;
      const ar = item.aspect_ratio || (item.width && item.height ? item.width / item.height : '');

      const mediaHTML = hasThumb
        ? `<img class="video-thumb" src="${thumbUrl}" loading="lazy" draggable="false"><video class="video-hover" data-src="${videoUrl}" preload="none" muted loop playsinline></video>`
        : `<video class="video-fallback" data-src="${videoUrl}" preload="none" muted loop playsinline></video>`;

      return `<div class="gallery-card video-card-item${selected}" data-fp="${item.fingerprint}" data-video-src="${videoUrl}" data-ar="${ar}">
        <div class="gallery-grab">
          <button class="g-btn g-fav" data-fav="${isFav}" title="Favorite"><i class="${favIcon}"></i></button>
          <div class="gallery-grab-right">
            <button class="g-btn g-play-lock" title="Play with audio"><i class="fa-solid fa-play"></i></button>
            <button class="g-btn g-mute" title="Mute"><i class="fa-solid fa-volume-high"></i></button>
            <button class="g-btn g-folder" title="Open containing folder"><i class="fa-solid fa-folder-open"></i></button>
            <button class="g-btn g-trash" title="Move to trash"><i class="fa-regular fa-trash-can"></i></button>
          </div>
        </div>
        <div class="gallery-card-imgwrap video-thumb-wrap"${ar ? ` style="--ar:${ar}"` : ''}>
          ${mediaHTML}
          ${dur ? `<div class="video-duration">${dur}</div>` : ''}
        </div>
      </div>`;
    },

    formatDuration(seconds) {
      if (!seconds || seconds <= 0) return '';
      const m = Math.floor(seconds / 60);
      const s = Math.floor(seconds % 60);
      return m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `0:${String(s).padStart(2, '0')}`;
    },

    formatClock(seconds) {
      if (!seconds || !isFinite(seconds) || seconds < 0) return '0:00';
      const h = Math.floor(seconds / 3600);
      const m = Math.floor((seconds % 3600) / 60);
      const s = Math.floor(seconds % 60);
      return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
    },

    renderGrid(appendItems) {
      const grid = this.$refs.grid;
      if (!grid) return;
      if (appendItems) {
        grid.insertAdjacentHTML('beforeend', appendItems.map(it => this.cardHTML(it)).join(''));
      } else {
        grid.innerHTML = this.items.map(it => this.cardHTML(it)).join('');
        if (this.$refs.gridScroll) this.$refs.gridScroll.scrollTop = 0;
      }
      if (this.settings.layout === 'masonry') {
        this._layoutMasonry(!appendItems);
      }
    },

    prependCard(item) {
      const grid = this.$refs.grid;
      if (!grid) return;
      grid.insertAdjacentHTML('afterbegin', this.cardHTML(item));
      if (this.settings.layout === 'masonry') this._layoutMasonry(true);
    },

    updateCard(item) {
      const grid = this.$refs.grid;
      if (!grid) return;
      const el = grid.querySelector(`.gallery-card[data-fp="${CSS.escape(item.fingerprint)}"]`);
      if (el) { el.outerHTML = this.cardHTML(item); }
      if (this.settings.layout === 'masonry') this._layoutMasonry(true);
    },

    removeCard(fp) {
      const grid = this.$refs.grid;
      if (!grid) return;
      const el = grid.querySelector(`.gallery-card[data-fp="${CSS.escape(fp)}"]`);
      if (el) el.remove();
    },

    // =========================================================
    // Masonry (row-based: fills shortest column, L→R T→B)
    // =========================================================
    _masonryGap() { return 12; },

    _layoutMasonry(fullRecalc) {
      if (this.settings.layout !== 'masonry') return;
      const grid = this.$refs.grid;
      // Always set up the resize observer so that when the tab becomes
      // visible (x-show) or resizes, a full recalc fires automatically.
      this._setupMasonryResize(grid);
      if (!grid || !grid.children.length) { if (grid) grid.style.height = ''; return; }
      const gap = this._masonryGap();
      const targetW = Number(this.settings.cardWidth) || 240;
      const cw = grid.clientWidth;
      if (cw <= 0) return;  // grid hidden — observer will recalc when visible
      const cols = Math.max(1, Math.floor((cw + gap) / (targetW + gap)));
      const colW = (cw - (cols - 1) * gap) / cols;
      if (fullRecalc || !this._masonryCols || this._masonryCols.length !== cols) {
        this._masonryCols = new Array(cols).fill(0);
        this._masonryLastCount = 0;
      }
      const startIdx = this._masonryLastCount;
      if (startIdx > 0 && startIdx >= grid.children.length) { grid.style.height = Math.max(...this._masonryCols, 0) + 'px'; return; }
      this._masonryPositionRange(startIdx, colW, gap);
      this._masonryLastCount = grid.children.length;
    },

    _masonryPositionRange(startIdx, colW, gap) {
      const grid = this.$refs.grid;
      const cards = grid.children;
      for (let i = startIdx; i < cards.length; i++) {
        const card = cards[i];
        const ar = parseFloat(card.dataset.ar) || 1;
        const h = colW / ar;
        let sc = 0;
        for (let c = 1; c < this._masonryCols.length; c++) {
          if (this._masonryCols[c] < this._masonryCols[sc]) sc = c;
        }
        const left = sc * (colW + gap);
        const top = this._masonryCols[sc];
        Object.assign(card.style, { position: 'absolute', left: left + 'px', top: top + 'px', width: colW + 'px', height: h + 'px' });
        this._masonryCols[sc] = top + h + gap;
      }
      grid.style.height = Math.max(...this._masonryCols, 0) + 'px';
    },

    _teardownMasonry() {
      this._masonryCols = null;
      this._masonryLastCount = 0;
      const grid = this.$refs.grid;
      if (!grid) return;
      grid.style.height = '';
      for (const card of grid.children) {
        card.style.position = ''; card.style.left = ''; card.style.top = '';
        card.style.width = ''; card.style.height = '';
      }
    },

    _setupMasonryResize(grid) {
      if (this._masonryResizeObserver) return;
      this._masonryResizeObserver = new ResizeObserver(() => {
        if (this.settings.layout === 'masonry') this._layoutMasonry(true);
      });
      this._masonryResizeObserver.observe(grid);
    },

    onGridScroll(e) {
      const el = e.target;
      if (el.scrollHeight - el.scrollTop - el.clientHeight < 600) {
        this.loadMore();
      }
    },

    // =========================================================
    // Grid event delegation
    // =========================================================
    attachGridHandlers() {
      const grid = this.$refs.grid;
      if (!grid) return;

      grid.addEventListener('click', (e) => {
        const card = e.target.closest('.gallery-card');
        if (!card) return;
        const fp = card.getAttribute('data-fp');

        if (e.target.closest('.g-fav')) {
          this.toggleFavorite(fp, card);
        } else if (e.target.closest('.g-trash')) {
          this.deleteItems([fp]);
        } else if (e.target.closest('.g-folder')) {
          this.openContainingFolder(fp);
        } else if (e.target.closest('.g-play-lock')) {
          this.toggleVideoPlayLock(card);
        } else if (e.target.closest('.g-mute')) {
          this.toggleVideoCardMute(card);
        } else if (e.target.closest('img') || e.target.closest('.video-thumb-wrap')) {
          // For videos, open viewer; for images, click on img opens viewer
          if (this.mediaType === 'videos') {
            const idx = this.items.findIndex(it => it.fingerprint === fp);
            if (idx >= 0) this.openVideoViewer(idx);
          } else {
            const idx = this.items.findIndex(it => it.fingerprint === fp);
            if (idx >= 0) this.openViewer(idx);
          }
        } else if (e.target.closest('.gallery-grab')) {
          this.toggleSelect(fp, card);
        }
      });

      // Hover preview for video cards
      grid.addEventListener('mouseenter', (e) => {
        const card = e.target.closest('.video-card-item');
        if (!card || card.classList.contains('playing-locked')) return;
        this._startVideoHover(card);
      }, true);
      grid.addEventListener('mouseleave', (e) => {
        const card = e.target.closest('.video-card-item');
        if (!card || card.classList.contains('playing-locked')) return;
        this._stopVideoHover(card);
      }, true);
    },

    _startVideoHover(card) {
      const hoverVideo = card.querySelector('video.video-hover');
      const fallbackVideo = card.querySelector('video.video-fallback');
      const thumb = card.querySelector('img.video-thumb');
      const video = hoverVideo || fallbackVideo;
      if (!video) return;
      if (!video.src && video.dataset.src) { video.src = video.dataset.src; video.load(); }
      if (thumb) thumb.style.display = 'none';
      if (hoverVideo) hoverVideo.style.display = 'block';
      video.play().catch(() => {});
    },

    _stopVideoHover(card) {
      const hoverVideo = card.querySelector('video.video-hover');
      const fallbackVideo = card.querySelector('video.video-fallback');
      const thumb = card.querySelector('img.video-thumb');
      const video = hoverVideo || fallbackVideo;
      if (!video) return;
      video.pause();
      video.currentTime = 0;
      if (thumb) { thumb.style.display = ''; if (hoverVideo) hoverVideo.style.display = ''; }
    },

    toggleVideoPlayLock(card) {
      const hoverVideo = card.querySelector('video.video-hover');
      const fallbackVideo = card.querySelector('video.video-fallback');
      const thumb = card.querySelector('img.video-thumb');
      const video = hoverVideo || fallbackVideo;
      const btn = card.querySelector('.g-play-lock i');
      if (!video) return;
      if (card.classList.contains('playing-locked')) {
        card.classList.remove('playing-locked'); video.pause(); video.currentTime = 0; video.muted = true;
        if (btn) btn.className = 'fa-solid fa-play';
        if (thumb) { thumb.style.display = ''; if (hoverVideo) hoverVideo.style.display = ''; }
      } else {
        card.classList.add('playing-locked'); video.muted = false;
        video.volume = this.videoVolume / 100;
        if (!video.src && video.dataset.src) { video.src = video.dataset.src; video.load(); }
        if (thumb) thumb.style.display = 'none';
        if (hoverVideo) hoverVideo.style.display = 'block';
        video.play().catch(() => {});
        if (btn) btn.className = 'fa-solid fa-pause';
        const muteBtn = card.querySelector('.g-mute i');
        if (muteBtn) muteBtn.className = video.muted ? 'fa-solid fa-volume-xmark' : 'fa-solid fa-volume-high';
      }
    },

    toggleVideoCardMute(card) {
      if (!card.classList.contains('playing-locked')) return;
      const video = card.querySelector('video.video-hover') || card.querySelector('video.video-fallback');
      const icon = card.querySelector('.g-mute i');
      if (!video) return;
      video.muted = !video.muted;
      if (icon) icon.className = video.muted ? 'fa-solid fa-volume-xmark' : 'fa-solid fa-volume-high';
    },

    // =========================================================
    // Selection
    // =========================================================
    toggleSelect(fp, card) {
      const i = this.selectedFps.indexOf(fp);
      if (i >= 0) {
        this.selectedFps.splice(i, 1);
        card.classList.remove('selected');
      } else {
        this.selectedFps.push(fp);
        card.classList.add('selected');
      }
    },

    clearSelection() {
      this.selectedFps = [];
      const grid = this.$refs.grid;
      if (grid) grid.querySelectorAll('.gallery-card.selected').forEach(c => c.classList.remove('selected'));
    },

    async bulkAddTag() {
      const label = this.mediaType === 'videos' ? 'video' : 'image';
      const tag = prompt(`Add tag to ${this.selectedFps.length} selected ${label}(s):`);
      if (!tag || !tag.trim()) return;
      const addFn = this.mediaType === 'videos' ? api.gallery.videoAddTags : api.gallery.addTags;
      await addFn(this.selectedFps.slice(), [tag.trim()]);
      await this.refreshTags();
      for (const fp of this.selectedFps) {
        const it = this.items.find(x => x.fingerprint === fp);
        if (it && !it.tags.includes(tag.trim())) it.tags.push(tag.trim());
        this.refreshCard(fp);
      }
    },

    async bulkDelete() {
      if (!this.selectedFps.length) return;
      await this.deleteItems(this.selectedFps.slice());
    },

    refreshCard(fp) {
      const grid = this.$refs.grid;
      if (!grid) return;
      const el = grid.querySelector(`.gallery-card[data-fp="${CSS.escape(fp)}"]`);
      const it = this.items.find(x => x.fingerprint === fp);
      if (el && it) el.outerHTML = this.cardHTML(it);
    },

    // =========================================================
    // Tags / favorites / delete
    // =========================================================
    async toggleFavorite(fp, card) {
      const it = this.items.find(x => x.fingerprint === fp);
      if (!it) return;
      const isFav = it.tags.includes('favorite');
      const addTags = this.mediaType === 'videos' ? api.gallery.videoAddTags : api.gallery.addTags;
      const removeTags = this.mediaType === 'videos' ? api.gallery.videoRemoveTags : api.gallery.removeTags;
      if (isFav) {
        await removeTags([fp], ['favorite']);
        it.tags = it.tags.filter(t => t !== 'favorite');
      } else {
        await addTags([fp], ['favorite']);
        it.tags.push('favorite');
      }
      if (card) {
        const btn = card.querySelector('.g-fav');
        if (btn) {
          btn.setAttribute('data-fav', String(!isFav));
          const icon = btn.querySelector('i');
          if (icon) icon.className = !isFav ? 'fa-solid fa-heart' : 'fa-regular fa-heart';
        }
      }
      this.refreshTags();
    },

    async deleteItems(fps) {
      if (!fps.length) return;
      if (this.settings.confirmDelete) {
        const label = this.mediaType === 'videos' ? 'video' : 'image';
        const msg = fps.length === 1
          ? `Move this ${label} to trash?`
          : `Move ${fps.length} ${label}s to trash?`;
        if (!confirm(msg)) return;
      }
      if (this.mediaType === 'videos') {
        await api.gallery.videoDelete(fps);
      } else {
        await api.gallery.delete(fps);
      }
      for (const fp of fps) {
        this.removeCard(fp);
        this.items = this.items.filter(x => x.fingerprint !== fp);
        this.selectedFps = this.selectedFps.filter(x => x !== fp);
      }
      this.total = Math.max(0, this.total - fps.length);
    },

    async openContainingFolder(fp) {
      if (this.mediaType === 'videos') {
        const item = this.items.find(x => x.fingerprint === fp);
        if (item && item.file_path) {
          try {
            await fetch('/api/gallery/open', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ file_path: item.file_path })
            });
          } catch (e) { console.error('[Gallery] open folder failed:', e); }
        }
      } else {
        try { await api.gallery.openFolder(fp); } catch (e) { console.error('[Gallery] open folder failed:', e); }
      }
    },

    async refreshTags() {
      try { this.tags = this.mediaType === 'videos' ? await api.gallery.videoTags() : await api.gallery.tags(); } catch (_) {}
    },

    // =========================================================
    // Trash (managed from the settings sidebar)
    // =========================================================
    openSettings() {
      this.settingsOpen = !this.settingsOpen;
      if (this.settingsOpen) this.loadTrash();
    },

    async loadTrash() {
      try { this.trashItems = await api.gallery.trash(); } catch (_) { this.trashItems = []; }
    },

    async restoreTrash(fp) {
      await api.gallery.restore([fp]);
      this.trashItems = this.trashItems.filter(t => t.fingerprint !== fp);
      this.search(false);
    },

    async restoreAll() {
      if (!this.trashItems.length) return;
      const fps = this.trashItems.map(t => t.fingerprint);
      await api.gallery.restore(fps);
      this.trashItems = [];
      this.search(false);
    },

    async emptyTrash() {
      if (!this.trashItems.length) return;
      if (!confirm('Permanently delete all trashed images? This cannot be undone.')) return;
      await api.gallery.emptyTrash();
      this.trashItems = [];
    },

    async openTrashFolder() {
      try { await api.gallery.openTrashFolder(); } catch (e) { console.error('[Gallery] open trash failed:', e); }
    },

    // =========================================================
    // Socket handlers
    // =========================================================
    onSocketNew(image) {
      if (!image) return;
      this.total++;
      const isDefaultView = !this.searchQuery.trim() && this.sortKey === 'btime' && this.sortDir === -1;
      if (isDefaultView && !this.items.some(x => x.fingerprint === image.fingerprint)) {
        if (!image.tags) image.tags = [];
        this.items.unshift(image);
        this.prependCard(image);
      }
    },

    onSocketUpdate(image) {
      if (!image) return;
      const idx = this.items.findIndex(x => x.fingerprint === image.fingerprint);
      if (idx !== -1) {
        if (!image.tags) image.tags = [];
        this.items[idx] = image;
        this.updateCard(image);
      }
    },

    onSocketRemove(fp) {
      this.removeCard(fp);
      this.items = this.items.filter(x => x.fingerprint !== fp);
      this.total = Math.max(0, this.total - 1);
    },

    onSocketProgress(data) {
      if (!data) return;
      this.scan = { active: !data.done, current: data.current || 0, total: data.total || 0 };
      if (data.done) setTimeout(() => { this.scan.active = false; }, 1500);
    },

    // =========================================================
    // Crop tool
    // =========================================================
    enterCropMode() {
      if (!this._overlay || this.crop.active) return;
      this.viewerReset();
      this.crop.active = true;

      const item = this.items[this._viewerIndex];
      const imgEl = this._overlay.querySelector('.gallery-viewer-img');
      if (!imgEl || !item) return;

      const nw = imgEl.naturalWidth || item.width || 100;
      const nh = imgEl.naturalHeight || item.height || 100;
      const margin = 0.08;
      this.crop.x = Math.round(nw * margin);
      this.crop.y = Math.round(nh * margin);
      this.crop.w = Math.round(nw * (1 - margin * 2));
      this.crop.h = Math.round(nh * (1 - margin * 2));
      this.crop.dragging = false;
      this.crop.handle = null;
      this.crop.aspectLocked = false;
      this.crop.aspectRatio = 1;

      this._cropBuildOverlay();
      this._cropUpdateOverlay();

      const navBtns = this._overlay.querySelectorAll('.gallery-viewer-nav');
      navBtns.forEach(b => b.style.display = 'none');
    },

    exitCropMode() {
      this.crop.active = false;
      if (this._cropEl) { this._cropEl.remove(); this._cropEl = null; }
      if (this._cropMouseMoveBound) { document.removeEventListener('mousemove', this._cropMouseMoveBound); this._cropMouseMoveBound = null; }
      if (this._cropMouseUpBound) { document.removeEventListener('mouseup', this._cropMouseUpBound); this._cropMouseUpBound = null; }
      const navBtns = this._overlay && this._overlay.querySelectorAll('.gallery-viewer-nav');
      if (navBtns) navBtns.forEach(b => b.style.display = '');
    },

    cancelCrop() {
      this.exitCropMode();
    },

    async confirmCrop() {
      const item = this.items[this._viewerIndex];
      if (!item) return;
      const x = Math.max(0, Math.round(this.crop.x));
      const y = Math.max(0, Math.round(this.crop.y));
      const w = Math.max(1, Math.round(this.crop.w));
      const h = Math.max(1, Math.round(this.crop.h));
      if (w < 10 || h < 10) { alert('Crop region is too small.'); return; }
      try {
        await api.gallery.crop(item.fingerprint, x, y, w, h);
        this.exitCropMode();
      } catch (e) {
        alert('Crop failed: ' + e.message);
      }
    },

    _cropImageRect() {
      const img = this._overlay && this._overlay.querySelector('.gallery-viewer-img');
      if (!img) return null;
      const r = img.getBoundingClientRect();
      return {
        left: r.left, top: r.top, width: r.width, height: r.height,
        naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight,
        scaleX: r.width / (img.naturalWidth || 1),
        scaleY: r.height / (img.naturalHeight || 1),
      };
    },

    _cropScreenToImage(sx, sy) {
      const ri = this._cropImageRect();
      if (!ri) return { x: 0, y: 0 };
      return { x: (sx - ri.left) / ri.scaleX, y: (sy - ri.top) / ri.scaleY };
    },

    _cropImageToScreen(ix, iy) {
      const ri = this._cropImageRect();
      if (!ri) return { x: 0, y: 0 };
      return { x: ri.left + ix * ri.scaleX, y: ri.top + iy * ri.scaleY };
    },

    _cropClamp() {
      const item = this.items[this._viewerIndex];
      const nw = item ? (item.width || 4096) : 4096;
      const nh = item ? (item.height || 4096) : 4096;
      const c = this.crop;
      c.w = Math.max(10, Math.min(c.w, nw));
      c.h = Math.max(10, Math.min(c.h, nh));
      if (c.x < 0) c.x = 0;
      if (c.y < 0) c.y = 0;
      if (c.x + c.w > nw) c.x = nw - c.w;
      if (c.y + c.h > nh) c.y = nh - c.h;
    },

    _cropApplyAspect(fixedPoint) {
      if (!this.crop.aspectLocked) return;
      const ratio = this.crop.aspectRatio;
      const c = this.crop;
      let nw, nh;
      if (fixedPoint === 'center') {
        nw = c.h * ratio;
        nh = c.w / ratio;
        if (nw <= this.items[this._viewerIndex]?.width) {
          c.h = Math.round(nh); c.y = c.origY + (c.origH - c.h) / 2;
        } else {
          c.w = Math.round(nw); c.x = c.origX + (c.origW - c.w) / 2;
        }
      } else {
        c.h = Math.round(c.w / ratio);
      }
      this._cropClamp();
    },

    _cropOverlayMouseDown(e) {
      const target = e.target;
      const handle = target.getAttribute('data-handle');
      const c = this.crop;

      if (handle) {
        c.dragging = true;
        c.handle = handle;
        const pt = this._cropScreenToImage(e.clientX, e.clientY);
        c.startSX = pt.x;
        c.startSY = pt.y;
        c.origX = c.x; c.origY = c.y; c.origW = c.w; c.origH = c.h;
        e.preventDefault();
        e.stopPropagation();
      } else if (target.classList.contains('gv-crop-box') || target.closest('.gv-crop-box')) {
        c.dragging = true;
        c.handle = 'move';
        c.origX = c.x; c.origY = c.y;
        const pt = this._cropScreenToImage(e.clientX, e.clientY);
        c.startIX = pt.x;
        c.startIY = pt.y;
        e.preventDefault();
        e.stopPropagation();
      } else if (target.classList.contains('gv-crop-overlay') || target.classList.contains('gv-crop-mask')) {
        c.dragging = true;
        c.handle = 'draw';
        const pt = this._cropScreenToImage(e.clientX, e.clientY);
        c.x = pt.x; c.y = pt.y; c.w = 0; c.h = 0;
        c.origX = pt.x; c.origY = pt.y;
        c.startSX = e.clientX; c.startSY = e.clientY;
        e.preventDefault();
      }
    },

    _cropOverlayMouseMove(e) {
      if (!this.crop.active || !this.crop.dragging) return;
      const c = this.crop;
      const pt = this._cropScreenToImage(e.clientX, e.clientY);

      if (c.handle === 'draw') {
        const x1 = Math.min(c.origX, pt.x);
        const y1 = Math.min(c.origY, pt.y);
        c.x = x1; c.y = y1;
        c.w = Math.max(c.origX, pt.x) - x1;
        c.h = Math.max(c.origY, pt.y) - y1;
        this._cropClamp();
      } else if (c.handle === 'move') {
        c.x = c.origX + (pt.x - c.startIX);
        c.y = c.origY + (pt.y - c.startIY);
        this._cropClamp();
      } else {
        this._cropHandleResize(pt.x, pt.y);
        this._cropClamp();
        if (c.aspectLocked && c.handle && /^(nw|ne|sw|se)$/.test(c.handle)) {
          this._cropApplyAspect('center');
        }
      }
      this._cropUpdateOverlay();
    },

    _cropHandleResize(px, py) {
      const c = this.crop;
      const handle = c.handle;
      if (handle.indexOf('e') !== -1) {
        c.w = Math.max(10, c.origW + (px - c.startSX));
      }
      if (handle.indexOf('s') !== -1) {
        c.h = Math.max(10, c.origH + (py - c.startSY));
      }
      if (handle.indexOf('w') !== -1) {
        const newW = Math.max(10, c.origW - (px - c.startSX));
        if (newW >= 10) { c.x = c.origX + c.origW - newW; c.w = newW; }
      }
      if (handle.indexOf('n') !== -1) {
        const newH = Math.max(10, c.origH - (py - c.startSY));
        if (newH >= 10) { c.y = c.origY + c.origH - newH; c.h = newH; }
      }
      if (c.aspectLocked && (handle === 'n' || handle === 's' || handle === 'e' || handle === 'w')) {
        const ratio = c.aspectRatio;
        const cx = c.x + c.w / 2;
        const cy = c.y + c.h / 2;
        if (handle === 'e' || handle === 'w') {
          c.h = Math.round(c.w / ratio);
          c.y = Math.round(cy - c.h / 2);
        } else {
          c.w = Math.round(c.h * ratio);
          c.x = Math.round(cx - c.w / 2);
        }
      }
    },

    _cropOverlayMouseUp(e) {
      if (!this.crop.active) return;
      const c = this.crop;
      if (c.dragging && c.handle === 'draw' && (c.w < 5 || c.h < 5)) {
        c.x = c.origX; c.y = c.origY; c.w = 0; c.h = 0;
        this._cropUpdateOverlay();
      }
      c.dragging = false;
    },

    _cropBuildOverlay() {
      const area = this._overlay.querySelector('.gallery-viewer-image-area');
      if (!area) return;
      const el = document.createElement('div');
      el.className = 'gv-crop-overlay';
      el.innerHTML = `
        <div class="gv-crop-mask-t"></div>
        <div class="gv-crop-mask-b"></div>
        <div class="gv-crop-mask-l"></div>
        <div class="gv-crop-mask-r"></div>
        <div class="gv-crop-box">
          <div class="gv-crop-grid-v1"></div>
          <div class="gv-crop-grid-v2"></div>
          <div class="gv-crop-grid-h1"></div>
          <div class="gv-crop-grid-h2"></div>
        </div>
        <div class="gv-crop-handle" data-handle="nw"></div>
        <div class="gv-crop-handle" data-handle="n"></div>
        <div class="gv-crop-handle" data-handle="ne"></div>
        <div class="gv-crop-handle" data-handle="e"></div>
        <div class="gv-crop-handle" data-handle="se"></div>
        <div class="gv-crop-handle" data-handle="s"></div>
        <div class="gv-crop-handle" data-handle="sw"></div>
        <div class="gv-crop-handle" data-handle="w"></div>
        <div class="gv-crop-toolbar">
          <span class="gv-crop-dims"></span>
          <select class="gv-crop-aspect">
            <option value="0">Free</option>
            <option value="1">1:1</option>
            <option value="0.75">4:3</option>
            <option value="0.5625">16:9</option>
            <option value="0.6667">3:2</option>
          </select>
          <button class="gv-crop-btn gv-crop-cancel">Cancel</button>
          <button class="gv-crop-btn gv-crop-confirm">Crop <i class="fa-solid fa-crop-simple"></i></button>
        </div>
        <div class="gv-crop-hint">Drag to adjust selection &mdash; Enter to confirm, Esc to cancel</div>
      `;
      area.appendChild(el);
      this._cropEl = el;

      const $ = (s) => el.querySelector(s);
      this._cropCache = {
        maskT: $('.gv-crop-mask-t'),
        maskB: $('.gv-crop-mask-b'),
        maskL: $('.gv-crop-mask-l'),
        maskR: $('.gv-crop-mask-r'),
        box: $('.gv-crop-box'),
        handles: [...el.querySelectorAll('.gv-crop-handle')],
        dims: $('.gv-crop-dims'),
        toolbar: $('.gv-crop-toolbar'),
        hint: $('.gv-crop-hint'),
      };

      el.addEventListener('mousedown', (e) => this._cropOverlayMouseDown(e));
      this._cropMouseMoveBound = (e) => this._cropOverlayMouseMove(e);
      this._cropMouseUpBound = (e) => this._cropOverlayMouseUp(e);
      document.addEventListener('mousemove', this._cropMouseMoveBound);
      document.addEventListener('mouseup', this._cropMouseUpBound);

      $('.gv-crop-aspect').addEventListener('change', (e) => {
        const val = parseFloat(e.target.value);
        this.crop.aspectLocked = val > 0;
        if (val > 0) {
          this.crop.aspectRatio = val;
          this._cropApplyAspect('center');
          this._cropClamp();
          this._cropUpdateOverlay();
        }
      });
      $('.gv-crop-cancel').addEventListener('click', (e) => { e.stopPropagation(); this.cancelCrop(); });
      $('.gv-crop-confirm').addEventListener('click', (e) => { e.stopPropagation(); this.confirmCrop(); });
    },

    _cropUpdateOverlay() {
      if (!this._cropCache) return;
      const cc = this._cropCache;
      const c = this.crop;
      const topLeft = this._cropImageToScreen(c.x, c.y);
      const botRight = this._cropImageToScreen(c.x + c.w, c.y + c.h);
      const area = this._overlay && this._overlay.querySelector('.gallery-viewer-image-area');
      if (!area) return;
      const areaRect = area.getBoundingClientRect();
      const aw = areaRect.width;
      const ah = areaRect.height;

      const sl = Math.max(0, topLeft.x - areaRect.left);
      const st = Math.max(0, topLeft.y - areaRect.top);
      const sw = Math.max(0, botRight.x - topLeft.x);
      const sh = Math.max(0, botRight.y - topLeft.y);
      const sr = sl + sw;
      const sb = st + sh;

      cc.maskT.style.cssText = `left:0;top:0;width:${aw}px;height:${st}px;`;
      cc.maskB.style.cssText = `left:0;top:${sb}px;width:${aw}px;height:${ah - sb}px;`;
      cc.maskL.style.cssText = `left:0;top:${st}px;width:${sl}px;height:${sh}px;`;
      cc.maskR.style.cssText = `left:${sr}px;top:${st}px;width:${aw - sr}px;height:${sh}px;`;
      cc.box.style.cssText = `left:${sl}px;top:${st}px;width:${sw}px;height:${sh}px;`;

      const handlesCoords = {
        nw: [sl - 7, st - 7], n: [sl + sw / 2 - 7, st - 7], ne: [sl + sw - 7, st - 7],
        e: [sl + sw - 7, st + sh / 2 - 7], se: [sl + sw - 7, st + sh - 7],
        s: [sl + sw / 2 - 7, st + sh - 7], sw: [sl - 7, st + sh - 7],
        w: [sl - 7, st + sh / 2 - 7],
      };
      cc.handles.forEach(h => {
        const key = h.getAttribute('data-handle');
        const [hx, hy] = handlesCoords[key] || [0, 0];
        h.style.cssText = `left:${hx}px;top:${hy}px;`;
      });

      cc.dims.textContent = `${Math.round(c.w)} \u00d7 ${Math.round(c.h)} px`;
      const hVisible = c.w > 0 && c.h > 0;
      cc.toolbar.style.display = hVisible ? '' : 'none';
      cc.hint.style.display = hVisible ? 'none' : '';
    },

    // =========================================================
    // Output queue & viewer
    // =========================================================
    _onJobStarted(job) {
      if (!job || !job.job_id) return;
      if (this.jobs.some(j => j.job_id === job.job_id)) return;
      this.jobs.unshift({
        job_id: job.job_id,
        type: job.type || 'unknown',
        status: 'processing',
        output_url: null,
        input_url: null,
        created_at: Date.now(),
        completed_at: null,
      });
      if (this.jobs.length > 100) this.jobs.pop();
    },

    _onJobCompleted(job) {
      if (!job || !job.job_id) return;
      const existing = this.jobs.find(j => j.job_id === job.job_id);
      if (existing) {
        existing.status = 'done';
        existing.output_url = job.output_url || null;
        existing.input_url = job.input_url || null;
        existing.completed_at = Date.now();
      } else {
        this.jobs.unshift({
          job_id: job.job_id,
          type: job.type || 'unknown',
          status: 'done',
          output_url: job.output_url || null,
          input_url: job.input_url || null,
          created_at: Date.now(),
          completed_at: Date.now(),
        });
        if (this.jobs.length > 100) this.jobs.pop();
      }
    },

    _onJobError(data) {
      if (!data || !data.job_id) return;
      const existing = this.jobs.find(j => j.job_id === data.job_id);
      if (existing) {
        existing.status = 'error';
        existing.error = data.error || 'Unknown error';
      }
    },

    get _completedJobs() {
      return this.jobs.filter(j => j.status === 'done');
    },

    get _doneCount() {
      return this._completedJobs.length;
    },

    get _folders() {
      return this.mediaType === 'videos' ? this.videoFolders : this.imageFolders;
    },

    get _bookmarks() {
      return this.mediaType === 'videos' ? this.videoBookmarks : this.imageBookmarks;
    },

    openQueue() {
      if (this.settingsOpen) this.settingsOpen = false;
      if (this.foldersOpen) this.foldersOpen = false;
      this.queueOpen = !this.queueOpen;
    },

    cancelJob(jobId) {
      this.jobs = this.jobs.filter(j => j.job_id !== jobId || j.status === 'done');
    },

    openOutputViewer(startIndex = 0) {
      if (!this._doneCount) return;
      this.queueOpen = false;
      this.outputViewerOpen = true;
      this.outputViewerIndex = startIndex;
      this._outputSliderPos = 50;
      this._outputZoom = 1;
      this._outputPanX = 0;
      this._outputPanY = 0;
      this._outputBuildOverlay();
      this._outputShowImage();
      this._outputKeyHandler = (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        if (e.key === 'Escape') this.closeOutputViewer();
        else if (e.key === 'ArrowLeft') this.outputViewerNav(-1);
        else if (e.key === 'ArrowRight') this.outputViewerNav(1);
      };
      document.addEventListener('keydown', this._outputKeyHandler);
    },

    openOutputViewerForJob(jobId) {
      const idx = this._completedJobs.findIndex(j => j.job_id === jobId);
      if (idx >= 0) this.openOutputViewer(idx);
    },

    closeOutputViewer() {
      this.outputViewerOpen = false;
      this.outputViewerIndex = 0;
      this._outputDestroyOverlay();
      if (this._outputKeyHandler) {
        document.removeEventListener('keydown', this._outputKeyHandler);
        this._outputKeyHandler = null;
      }
    },

    outputViewerNav(dir) {
      const jobs = this._completedJobs;
      if (!jobs.length) return;
      const ni = this.outputViewerIndex + dir;
      if (ni < 0 || ni >= jobs.length) return;
      this.outputViewerIndex = ni;
      this._outputSliderPos = 50;
      this._outputZoom = 1;
      this._outputPanX = 0;
      this._outputPanY = 0;
      this._outputShowImage();
    },

    _outputShowImage() {
      const jobs = this._completedJobs;
      const job = jobs[this.outputViewerIndex];
      if (!job || !this._outputOverlay) return;

      const imgBefore = this._outputOverlay.querySelector('.gv-out-before');
      const imgAfter = this._outputOverlay.querySelector('.gv-out-after');
      const counter = this._outputOverlay.querySelector('.gallery-viewer-counter');
      const hasInput = !!job.input_url;

      if (imgAfter) { const pre = new Image(); pre.onload = pre.onerror = () => { imgAfter.src = job.output_url; }; pre.src = job.output_url; }
      if (imgBefore) { const pre = new Image(); pre.onload = pre.onerror = () => { imgBefore.src = hasInput ? job.input_url : job.output_url; imgBefore.style.display = ''; }; pre.src = hasInput ? job.input_url : job.output_url; }
      if (counter) counter.textContent = `Result ${this.outputViewerIndex + 1} / ${jobs.length}`;

      const prevBtn = this._outputOverlay.querySelector('.gallery-viewer-prev');
      const nextBtn = this._outputOverlay.querySelector('.gallery-viewer-next');
      if (prevBtn) prevBtn.style.visibility = this.outputViewerIndex > 0 ? 'visible' : 'hidden';
      if (nextBtn) nextBtn.style.visibility = this.outputViewerIndex < jobs.length - 1 ? 'visible' : 'hidden';

      this._outputZoom = 1; this._outputPanX = 0; this._outputPanY = 0;
      this._outputSliderPos = 50;
      this._outputApplyTransform();
      this._outputUpdateSlider();
    },

    _outputApplyTransform() {
      const img = this._outputOverlay && this._outputOverlay.querySelector('.gv-out-after');
      const wrap = this._outputOverlay && this._outputOverlay.querySelector('.gv-out-zoom-wrap');
      if (wrap) wrap.style.transform = `scale(${this._outputZoom}) translate(${this._outputPanX}px, ${this._outputPanY}px)`;
      const lbl = this._outputOverlay && this._outputOverlay.querySelector('.gv-zoom-level');
      if (lbl) lbl.textContent = Math.round(this._outputZoom * 100) + '%';
    },

    _outputSliderStyle() {
      return `left: ${this._outputSliderPos}%`;
    },

    _outputClipStyle() {
      const compare = this._outputOverlay && this._outputOverlay.querySelector('.gv-output-compare');
      if (!compare) return 'polygon(50% 0, 100% 0, 100% 100%, 50% 100%)';
      const W = compare.getBoundingClientRect().width;
      const sliderPx = (this._outputSliderPos / 100) * W;
      const wx = (sliderPx - W / 2) / this._outputZoom - this._outputPanX + W / 2;
      const pct = Math.max(0, Math.min(100, (wx / W) * 100));
      return `polygon(${pct}% 0, 100% 0, 100% 100%, ${pct}% 100%)`;
    },

    _outputUpdateSlider() {
      const bar = this._outputOverlay && this._outputOverlay.querySelector('.gv-out-slider-bar');
      const after = this._outputOverlay && this._outputOverlay.querySelector('.gv-out-after');
      if (bar) bar.style.cssText = this._outputSliderStyle();
      if (after) after.style.clipPath = this._outputClipStyle();
      this._outputApplyTransform();
    },

    async outputViewerSave() {
      const job = this._completedJobs[this.outputViewerIndex];
      if (!job || !job.output_url) return;

      const ts = Date.now().toString(36);
      const typePrefix = job.type === 'enhance' ? 'enh' : job.type === 'generate' ? 'gen' : 'out';
      const destName = `senzu_${typePrefix}_${ts}.png`;

      await api.saveOutput(job.output_url, { saveFolder: this._appSaveFolder, destName });
      this._outputSetSaveButtonState(true);
      setTimeout(() => this._outputSetSaveButtonState(false), 2000);
    },

    _outputSetSaveButtonState(isSaved) {
      const btn = this._outputOverlay && this._outputOverlay.querySelector('.gv-out-save');
      if (btn) {
        btn.innerHTML = isSaved ? '<i class="fa-solid fa-check"></i> Saved' : '<i class="fa-solid fa-download"></i> Save';
        btn.style.background = isSaved ? 'var(--success)' : '';
        btn.style.color = isSaved ? '#000' : '';
        btn.style.borderColor = isSaved ? 'transparent' : '';
      }
    },

    async outputViewerSendToEnhancer() {
      const job = this._completedJobs[this.outputViewerIndex];
      if (!job || !job.output_url) return;
      try {
        const blob = await fetch(job.output_url).then(r => r.blob());
        const name = 'output_' + Date.now().toString(36) + '.png';
        const file = new File([blob], name, { type: blob.type || 'image/png' });
        this.closeOutputViewer();
        window.dispatchEvent(new CustomEvent('senzu:route-image', { detail: { file, target: 'enhance' } }));
      } catch (err) {
        alert('Failed to send image: ' + (err.message || err));
      }
    },

    _outputBuildOverlay() {
      this._outputDestroyOverlay();
      const overlay = document.createElement('div');
      overlay.className = 'gv-output-overlay';
      overlay.innerHTML = `
        <div class="gallery-viewer-main">
          <div class="gallery-viewer-image-area">
            <button class="gallery-viewer-nav gallery-viewer-prev" title="Previous (←)"><i class="fa-solid fa-chevron-left"></i></button>
            <div class="gv-output-compare">
              <div class="gv-out-zoom-wrap">
                <img class="gv-out-before gv-out-img" src="" draggable="false">
                <img class="gv-out-after gv-out-img" src="" draggable="false">
              </div>
              <div class="gv-out-slider-bar"><div class="gv-out-slider-handle"><i class="fa-solid fa-arrows-left-right"></i></div></div>
            </div>
            <button class="gallery-viewer-nav gallery-viewer-next" title="Next (→)"><i class="fa-solid fa-chevron-right"></i></button>
          </div>
          <div class="gallery-viewer-toolbar">
            <button class="btn btn-sm btn-primary gv-out-save"><i class="fa-solid fa-download"></i> Save</button>
            <span class="gallery-viewer-counter" style="min-width:110px;">Result 1 / 1</span>
            <span class="gv-sep"></span>
            <button class="gv-btn gv-out-zoom-out" title="Zoom out (−)"><i class="fa-solid fa-magnifying-glass-minus"></i></button>
            <button class="gv-btn gv-out-zoom-reset" title="Fit (0)"><i class="fa-solid fa-expand"></i></button>
            <button class="gv-btn gv-out-zoom-in" title="Zoom in (+)"><i class="fa-solid fa-magnifying-glass-plus"></i></button>
            <span class="gv-zoom-level">100%</span>
            <span class="gv-sep"></span>
            <button class="gv-btn gv-out-enhance" title="Send to Enhancer"><i class="fa-solid fa-wand-magic-sparkles"></i></button>
            <button class="gv-btn gv-out-close" title="Close (Esc)"><i class="fa-solid fa-xmark"></i></button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
      this._outputOverlay = overlay;

      const $ = (s) => overlay.querySelector(s);
      $('.gv-out-save').addEventListener('click', (e) => { e.stopPropagation(); this.outputViewerSave(); });
      $('.gv-out-zoom-in').addEventListener('click', (e) => { e.stopPropagation(); this._outputZoomCenter(0.25); });
      $('.gv-out-zoom-out').addEventListener('click', (e) => { e.stopPropagation(); this._outputZoomCenter(-0.25); });
      $('.gv-out-zoom-reset').addEventListener('click', (e) => { e.stopPropagation(); this._outputReset(); });
      $('.gv-out-enhance').addEventListener('click', (e) => { e.stopPropagation(); this.outputViewerSendToEnhancer(); });
      $('.gv-out-close').addEventListener('click', (e) => { e.stopPropagation(); this.closeOutputViewer(); });
      overlay.querySelectorAll('.gallery-viewer-prev').forEach(b => b.addEventListener('click', (e) => { e.stopPropagation(); this.outputViewerNav(-1); }));
      overlay.querySelectorAll('.gallery-viewer-next').forEach(b => b.addEventListener('click', (e) => { e.stopPropagation(); this.outputViewerNav(1); }));

      const compare = $('.gv-output-compare');
      compare.addEventListener('wheel', (e) => {
        e.preventDefault();
        this._outputZoomAt(e.deltaY < 0 ? 0.15 : -0.15, e.clientX, e.clientY);
      }, { passive: false });

      const sliderBar = $('.gv-out-slider-bar');
      sliderBar.addEventListener('mousedown', (e) => {
        e.preventDefault(); e.stopPropagation();
        this._outputDraggingSlider = true;
        this._outputUpdateSliderFromEvent(e);
      });
      sliderBar.addEventListener('touchstart', (e) => {
        e.preventDefault(); e.stopPropagation();
        this._outputDraggingSlider = true;
        this._outputUpdateSliderFromEvent(e.touches[0]);
      });
      this._outputSliderMove = (e) => {
        if (!this._outputDraggingSlider) return;
        this._outputUpdateSliderFromEvent(e.touches ? e.touches[0] : e);
      };
      this._outputSliderEnd = () => { this._outputDraggingSlider = false; };
      document.addEventListener('mousemove', this._outputSliderMove);
      document.addEventListener('mouseup', this._outputSliderEnd);
      document.addEventListener('touchmove', this._outputSliderMove);
      document.addEventListener('touchend', this._outputSliderEnd);

      let panStartX, panStartY, panOrigX, panOrigY, clickX, clickY;
      compare.addEventListener('mousedown', (e) => {
        if (e.target.closest('.gv-out-slider-bar') || e.target.closest('button')) return;
        clickX = e.clientX; clickY = e.clientY;
        panStartX = e.clientX; panStartY = e.clientY;
        panOrigX = this._outputPanX; panOrigY = this._outputPanY;
        this._outputPanning = true;
      });
      this._outputPanMove = (e) => {
        if (!this._outputPanning) return;
        this._outputPanX = panOrigX + (e.clientX - panStartX);
        this._outputPanY = panOrigY + (e.clientY - panStartY);
        this._outputUpdateSlider();
      };
      this._outputPanEnd = (e) => {
        if (this._outputPanning) {
          this._outputPanning = false;
          if (clickX !== undefined && e && Math.abs(e.clientX - clickX) < 5 && Math.abs(e.clientY - clickY) < 5) {
            this.closeOutputViewer();
          }
        }
        clickX = undefined;
      };
      document.addEventListener('mousemove', this._outputPanMove);
      document.addEventListener('mouseup', this._outputPanEnd);
    },

    _outputDestroyOverlay() {
      if (this._outputSliderMove) document.removeEventListener('mousemove', this._outputSliderMove);
      if (this._outputSliderEnd) document.removeEventListener('mouseup', this._outputSliderEnd);
      if (this._outputPanMove) document.removeEventListener('mousemove', this._outputPanMove);
      if (this._outputPanEnd) document.removeEventListener('mouseup', this._outputPanEnd);
      this._outputSliderMove = null; this._outputSliderEnd = null;
      this._outputPanMove = null; this._outputPanEnd = null;
      if (this._outputOverlay) { this._outputOverlay.remove(); this._outputOverlay = null; }
    },

    _outputZoomCenter(delta) {
      const compare = this._outputOverlay && this._outputOverlay.querySelector('.gv-output-compare');
      if (!compare) return;
      const r = compare.getBoundingClientRect();
      this._outputZoomAt(delta, r.left + r.width / 2, r.top + r.height / 2);
    },

    _outputZoomAt(delta, cx, cy) {
      const compare = this._outputOverlay && this._outputOverlay.querySelector('.gv-output-compare');
      if (!compare) return;
      const r = compare.getBoundingClientRect();
      const ox = cx - r.left - r.width / 2;
      const oy = cy - r.top - r.height / 2;
      const oldZoom = this._outputZoom;
      this._outputZoom = Math.max(0.1, Math.min(20, this._outputZoom + delta));
      const scale = this._outputZoom / oldZoom;
      this._outputPanX = ox - scale * (ox - this._outputPanX);
      this._outputPanY = oy - scale * (oy - this._outputPanY);
      this._outputUpdateSlider();
    },

    _outputReset() {
      this._outputZoom = 1; this._outputPanX = 0; this._outputPanY = 0;
      this._outputUpdateSlider();
    },

    _outputUpdateSliderFromEvent(e) {
      const compare = this._outputOverlay && this._outputOverlay.querySelector('.gv-output-compare');
      if (!compare) return;
      const r = compare.getBoundingClientRect();
      this._outputSliderPos = Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100));
      this._outputUpdateSlider();
    },

    formatTime(ms) {
      if (!ms) return '';
      const diff = Date.now() - ms;
      if (diff < 60000) return 'just now';
      if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
      if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
      return Math.floor(diff / 86400000) + 'd ago';
    },

    outputTypeLabel(type) {
      const map = { enhance: 'Enhance', generate: 'Generate', remove_bg: 'Remove BG', inpaint: 'Inpaint', outpaint: 'Outpaint' };
      return map[type] || type || 'Unknown';
    },

    // =========================================================
    // Fullscreen viewer
    // =========================================================
    openViewer(index) {
      this._viewerIndex = index;
      this._zoom = 1; this._panX = 0; this._panY = 0;
      this._panelHidden = !!this.settings.hidePanel;
      this.clearSelection();
      this.buildViewerOverlay();
      this.showViewerImage(index);

      this._keyHandler = (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
        if (this.crop.active) {
          if (e.key === 'Escape') { e.preventDefault(); this.cancelCrop(); }
          else if (e.key === 'Enter') { e.preventDefault(); this.confirmCrop(); }
          return;
        }
        if (e.key === 'Escape') this.closeViewer();
        else if (e.key === 'ArrowLeft') this.viewerNav(-1);
        else if (e.key === 'ArrowRight') this.viewerNav(1);
        else if (e.key === '+' || e.key === '=') this.viewerZoomCenter(0.25);
        else if (e.key === '-') this.viewerZoomCenter(-0.25);
        else if (e.key === '0') this.viewerReset();
        else if (e.key === ' ') { e.preventDefault(); this.toggleSlideshow(); }
        else if (e.key.toLowerCase() === 'i') this.togglePanel();
        else if (e.key.toLowerCase() === 'c') { e.preventDefault(); this.enterCropMode(); }
      };
      document.addEventListener('keydown', this._keyHandler);
    },

    buildViewerOverlay() {
      this.destroyViewerOverlay(true);
      const overlay = document.createElement('div');
      overlay.className = 'gallery-viewer-overlay';
      overlay.innerHTML = `
        <div class="gallery-viewer-main">
          <div class="gallery-viewer-image-area">
            <button class="gallery-viewer-nav gallery-viewer-prev" title="Previous (←)"><i class="fa-solid fa-chevron-left"></i></button>
            <div class="gallery-viewer-img-wrap"><img class="gallery-viewer-img" src="" draggable="false"></div>
            <button class="gallery-viewer-nav gallery-viewer-next" title="Next (→)"><i class="fa-solid fa-chevron-right"></i></button>
          </div>
          <div class="gallery-viewer-toolbar">
            <span class="gallery-viewer-counter"></span>
            <span class="gv-sep"></span>
            <button class="gv-btn gv-zoom-out" title="Zoom out (−)"><i class="fa-solid fa-magnifying-glass-minus"></i></button>
            <button class="gv-btn gv-zoom-reset" title="Fit (0)"><i class="fa-solid fa-expand"></i></button>
            <button class="gv-btn gv-zoom-in" title="Zoom in (+)"><i class="fa-solid fa-magnifying-glass-plus"></i></button>
            <span class="gv-zoom-level">100%</span>
            <span class="gv-sep"></span>
            <button class="gv-btn gv-slideshow" title="Slideshow (Space)"><i class="fa-solid fa-play"></i></button>
            <button class="gv-btn gv-panel" title="Info (i)"><i class="fa-solid fa-circle-info"></i></button>
            <span class="gv-sep"></span>
            <button class="gv-btn gv-enhance" title="Send to Enhancer"><i class="fa-solid fa-wand-magic-sparkles"></i></button>
            <button class="gv-btn gv-img2img" title="Send to Generate (img2img)"><i class="fa-solid fa-image"></i></button>
            <button class="gv-btn gv-crop-open" title="Crop (C)"><i class="fa-solid fa-crop-simple"></i></button>
            <button class="gv-btn gv-close" title="Close (Esc)"><i class="fa-solid fa-xmark"></i></button>
          </div>
        </div>
        <div class="gallery-viewer-panel${this._panelHidden ? ' collapsed' : ''}"><div class="gv-panel-body"></div></div>
      `;
      document.body.appendChild(overlay);
      this._overlay = overlay;

      const $ = (s) => overlay.querySelector(s);
      $('.gallery-viewer-prev').addEventListener('click', (e) => { e.stopPropagation(); this.viewerNav(-1); });
      $('.gallery-viewer-next').addEventListener('click', (e) => { e.stopPropagation(); this.viewerNav(1); });
      $('.gv-zoom-in').addEventListener('click', (e) => { e.stopPropagation(); this.viewerZoomCenter(0.25); });
      $('.gv-zoom-out').addEventListener('click', (e) => { e.stopPropagation(); this.viewerZoomCenter(-0.25); });
      $('.gv-zoom-reset').addEventListener('click', (e) => { e.stopPropagation(); this.viewerReset(); });
      $('.gv-slideshow').addEventListener('click', (e) => { e.stopPropagation(); this.toggleSlideshow(); });
      $('.gv-panel').addEventListener('click', (e) => { e.stopPropagation(); this.togglePanel(); });
      $('.gv-enhance').addEventListener('click', (e) => { e.stopPropagation(); this.sendToTab('enhance'); });
      $('.gv-img2img').addEventListener('click', (e) => { e.stopPropagation(); this.sendToTab('generate'); });
      $('.gv-crop-open').addEventListener('click', (e) => { e.stopPropagation(); this.enterCropMode(); });
      $('.gv-close').addEventListener('click', (e) => { e.stopPropagation(); this.closeViewer(); });
      $('.gallery-viewer-panel').addEventListener('click', (e) => e.stopPropagation());
      $('.gallery-viewer-toolbar').addEventListener('click', (e) => e.stopPropagation());

      const area = $('.gallery-viewer-image-area');
      area.addEventListener('wheel', (e) => {
        if (this.crop.active) return;
        e.preventDefault();
        this.viewerZoomAt(e.deltaY < 0 ? 0.15 : -0.15, e.clientX, e.clientY);
      }, { passive: false });

      const imgWrap = $('.gallery-viewer-img-wrap');
      let dragStartX, dragStartY, startPanX, startPanY, clickX, clickY, didDrag;
      area.addEventListener('mousedown', (e) => { if (e.target.closest('button')) return; clickX = e.clientX; clickY = e.clientY; didDrag = false; });
      imgWrap.addEventListener('mousedown', (e) => {
        if (this.crop.active) return;
        if (e.button !== 0) return;
        this._isPanning = true;
        dragStartX = e.clientX; dragStartY = e.clientY;
        startPanX = this._panX; startPanY = this._panY;
        imgWrap.style.cursor = 'grabbing';
        e.preventDefault();
      });
      this._onPanMove = (e) => {
        if (!this._isPanning) return;
        const dx = e.clientX - dragStartX, dy = e.clientY - dragStartY;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) didDrag = true;
        this._panX = startPanX + dx; this._panY = startPanY + dy;
        this.applyViewerTransform();
      };
      this._onPanEnd = (e) => {
        if (this._isPanning) {
          this._isPanning = false;
          imgWrap.style.cursor = this._zoom > 1 ? 'grab' : 'default';
        }
        if (!didDrag && clickX !== undefined) {
          const dx = Math.abs(e.clientX - clickX), dy = Math.abs(e.clientY - clickY);
          if (dx < 5 && dy < 5) {
            const target = document.elementFromPoint(e.clientX, e.clientY);
            if (target && (target.classList.contains('gallery-viewer-image-area') ||
              target.classList.contains('gallery-viewer-img-wrap'))) {
              this.closeViewer();
            }
          }
        }
        clickX = undefined;
      };
      document.addEventListener('mousemove', this._onPanMove);
      document.addEventListener('mouseup', this._onPanEnd);
    },

    destroyViewerOverlay(silent) {
      this.exitCropMode();
      this.stopSlideshow();
      if (this._onPanMove) { document.removeEventListener('mousemove', this._onPanMove); this._onPanMove = null; }
      if (this._onPanEnd) { document.removeEventListener('mouseup', this._onPanEnd); this._onPanEnd = null; }
      if (this._overlay) { this._overlay.remove(); this._overlay = null; }
    },

    closeViewer() {
      this.destroyViewerOverlay();
      if (this._keyHandler) { document.removeEventListener('keydown', this._keyHandler); this._keyHandler = null; }
    },

    async sendToTab(target) {
      const item = this.items[this._viewerIndex];
      if (!item || !item.src) return;
      try {
        const blob = await fetch(item.src).then(r => r.blob());
        const name = item.filename || ('gallery_' + Date.now().toString(36) + '.png');
        const file = new File([blob], name, { type: blob.type || 'image/png' });
        window.dispatchEvent(new CustomEvent('senzu:route-image', { detail: { file, target, stayInGallery: true } }));
        this._flashButton(target);
      } catch (err) {
        alert('Failed to send image: ' + (err.message || err));
      }
    },

    _flashButton(target) {
      const cls = target === 'enhance' ? '.gv-enhance' : target === 'generate' ? '.gv-img2img' : null;
      if (!cls || !this._overlay) return;
      const btn = this._overlay.querySelector(cls);
      if (!btn) return;
      const origHTML = btn.innerHTML;
      btn.innerHTML = '<i class="fa-solid fa-check"></i>';
      btn.style.background = 'var(--success)';
      btn.style.color = '#000';
      btn.style.borderColor = 'transparent';
      setTimeout(() => {
        btn.innerHTML = origHTML;
        btn.style.background = '';
        btn.style.color = '';
        btn.style.borderColor = '';
      }, 1200);
    },

    viewerNav(dir) {
      const ni = this._viewerIndex + dir;
      if (ni < 0 || ni >= this.items.length) {
        // Try to load more when reaching the end.
        if (dir > 0 && this.hasMore) { this.loadMore(); }
        return;
      }
      this._viewerIndex = ni;
      this._zoom = 1; this._panX = 0; this._panY = 0;
      this.showViewerImage(ni);
    },

    showViewerImage(index) {
      const item = this.items[index];
      if (!item || !this._overlay) return;
      const img = this._overlay.querySelector('.gallery-viewer-img');
      if (img) {
        const pre = new Image();
        pre.onload = pre.onerror = () => { img.src = item.src; this.applyViewerTransform(); };
        pre.src = item.src;
      }

      const label = `${index + 1} / ${this.items.length}`;
      const counter = this._overlay.querySelector('.gallery-viewer-counter');
      if (counter) counter.textContent = label;

      const prev = this._overlay.querySelector('.gallery-viewer-prev');
      const next = this._overlay.querySelector('.gallery-viewer-next');
      if (prev) prev.style.visibility = index > 0 ? 'visible' : 'hidden';
      if (next) next.style.visibility = index < this.items.length - 1 ? 'visible' : 'hidden';

      this.updateZoomLabel();
      this.loadViewerPanel(item);
    },

    // --- Zoom / pan ---
    viewerZoomCenter(delta) {
      const wrap = this._overlay && this._overlay.querySelector('.gallery-viewer-img-wrap');
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      this.viewerZoomAt(delta, rect.left + rect.width / 2, rect.top + rect.height / 2);
    },

    viewerZoomAt(delta, cx, cy) {
      const wrap = this._overlay && this._overlay.querySelector('.gallery-viewer-img-wrap');
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const ox = cx - rect.left - rect.width / 2;
      const oy = cy - rect.top - rect.height / 2;
      const oldZoom = this._zoom;
      this._zoom = Math.max(0.1, Math.min(20, this._zoom + delta));
      const scale = this._zoom / oldZoom;
      this._panX = ox - scale * (ox - this._panX);
      this._panY = oy - scale * (oy - this._panY);
      this.applyViewerTransform();
      this.updateZoomLabel();
      wrap.style.cursor = this._zoom > 1 ? 'grab' : 'default';
    },

    viewerReset() {
      this._zoom = 1; this._panX = 0; this._panY = 0;
      this.applyViewerTransform();
      this.updateZoomLabel();
    },

    applyViewerTransform() {
      const img = this._overlay && this._overlay.querySelector('.gallery-viewer-img');
      if (img) img.style.transform = `translate(${this._panX}px, ${this._panY}px) scale(${this._zoom})`;
    },

    updateZoomLabel() {
      const lbl = this._overlay && this._overlay.querySelector('.gv-zoom-level');
      if (lbl) lbl.textContent = Math.round(this._zoom * 100) + '%';
    },

    // --- Slideshow ---
    toggleSlideshow() {
      if (this._slideshowTimer) this.stopSlideshow();
      else this.startSlideshow();
    },
    startSlideshow() {
      const btn = this._overlay && this._overlay.querySelector('.gv-slideshow i');
      if (btn) { btn.classList.remove('fa-play'); btn.classList.add('fa-pause'); }
      const interval = Math.max(500, parseInt(this.settings.slideshowInterval, 10) || 3000);
      this._slideshowTimer = setInterval(() => {
        if (this._viewerIndex < this.items.length - 1) this.viewerNav(1);
        else { this._viewerIndex = -1; this.viewerNav(1); }
      }, interval);
    },
    stopSlideshow() {
      if (this._slideshowTimer) { clearInterval(this._slideshowTimer); this._slideshowTimer = null; }
      const btn = this._overlay && this._overlay.querySelector('.gv-slideshow i');
      if (btn) { btn.classList.remove('fa-pause'); btn.classList.add('fa-play'); }
    },

    // --- Info panel ---
    togglePanel() {
      const panel = this._overlay && this._overlay.querySelector('.gallery-viewer-panel');
      if (!panel) return;
      panel.classList.toggle('collapsed');
      this._panelHidden = panel.classList.contains('collapsed');
    },

    loadViewerPanel(item) {
      const body = this._overlay && this._overlay.querySelector('.gv-panel-body');
      if (!body) return;
      body.innerHTML = this.buildPanelHTML(item);
      this.attachPanelHandlers(body, item);
    },

    metaRow(label, value, filter) {
      if (value == null || value === '') return '';
      const chip = filter
        ? `<span class="gv-filter" data-filter="${this.escapeHTML(filter)}">${this.escapeHTML(value)}</span>`
        : `<span>${this.escapeHTML(value)}</span>`;
      return `<div class="gv-meta-row"><span class="gv-meta-key">${label}</span><span class="gv-meta-val">${chip}</span></div>`;
    },

    buildPanelHTML(item) {
      let loras = [];
      if (item.loras) { try { loras = JSON.parse(item.loras); } catch (_) {} }

      // Chained pipeline metadata (edit + upscale stages from process_params)
      let ppHTML = '';
      try {
        if (item.process_params) {
          const pp = JSON.parse(item.process_params);
          if (pp.edit || pp.upscale) {
            let ppt = '<div style="border-top: 1px solid var(--border-glass); margin-top: 10px; padding-top: 6px;">';
            if (pp.edit) {
              const edLoras = (pp.edit.loras || []).map(l =>
                 `<span class="gv-filter" data-filter="loras:${this.escapeHTML(l.name)}">${this.escapeHTML(l.name)}${l.strength != null ? ':' + l.strength : ''}</span>`
              ).join(' ');
              ppt += `<div class="gv-field-label">Senzu Edit</div>`;
              if (pp.edit.prompt) ppt += `<div class="gv-prompt" style="font-size: 0.82rem; margin-bottom: 4px;">${this.escapeHTML(pp.edit.prompt)}</div>`;
              if (edLoras) ppt += `<div class="gv-meta-row"><span class="gv-meta-key">LoRAs</span><span class="gv-meta-val">${edLoras}</span></div>`;
            }
            if (pp.upscale) {
              const upsRes = pp.upscale.resolution ? `${pp.upscale.resolution}px` : '';
              const upsModel = pp.upscale.model ? this.escapeHTML(pp.upscale.model.split('/').pop().replace(/\.(safetensors|pt|pth)$/, '')) : '';
              ppt += `<div style="border-top: 1px solid var(--border-glass); margin: 8px 0 4px;"></div>`;
              ppt += `<div class="gv-field-label">Senzu Upscale</div>`;
              if (upsModel) ppt += `<div class="gv-meta-row"><span class="gv-meta-key">Model</span><span class="gv-meta-val">${upsModel}</span></div>`;
              if (upsRes) ppt += `<div class="gv-meta-row"><span class="gv-meta-key">Resolution</span><span class="gv-meta-val">${upsRes}</span></div>`;
            }
            ppt += '</div>';
            ppHTML = ppt;
          }
        }
      } catch (_) {}
      const tagsHTML = (item.tags || []).map(t =>
        `<span class="gv-tag"><span class="gv-filter" data-filter="tag:${this.escapeHTML(t)}">${this.escapeHTML(t)}</span><i class="fa-solid fa-xmark gv-tag-remove" data-tag="${this.escapeHTML(t)}"></i></span>`
      ).join('');

      const lorasHTML = loras.length
        ? `<div class="gv-meta-row"><span class="gv-meta-key">LoRAs</span><span class="gv-meta-val">${
                loras.map(l => `<span class="gv-filter" data-filter="loras:${this.escapeHTML(l.name)}">${this.escapeHTML(l.name)}${l.strength != null ? ':' + l.strength : ''}</span>`).join(' ')
          }</span></div>`
        : '';

      const promptHTML = item.prompt
        ? `<div class="gv-field-label">Prompt</div><div class="gv-prompt">${this.escapeHTML(item.prompt)}</div>`
        : `<div class="gv-field-label">Prompt</div><div class="gv-prompt gv-empty">No prompt recorded</div>`;

      const negHTML = item.negative_prompt
        ? `<div class="gv-field-label">Negative</div><div class="gv-prompt gv-neg">${this.escapeHTML(item.negative_prompt)}</div>`
        : '';

      const dims = (item.width && item.height) ? `${item.width} × ${item.height}` : '';

      return `
        ${promptHTML}
        ${negHTML}
        <div class="gv-tags">${tagsHTML}
          <input type="text" class="gv-add-tag" placeholder="Add tag…">
        </div>
        <div class="gv-actions">
          <button class="gv-copy" data-value="${this.escapeHTML(item.prompt || '')}"><i class="fa-regular fa-clone"></i> Copy Prompt</button>
          <button class="gv-copy gv-open-folder"><i class="fa-solid fa-folder-open"></i> Open folder</button>
          <button class="gv-copy gv-trash"><i class="fa-regular fa-trash-can"></i> Trash</button>
        </div>
        <div class="gv-meta">
          ${this.metaRow('Model', item.model_name, 'model_name:' + item.model_name)}
          ${this.metaRow('CLIP', item.clip_name, 'clip_name:' + item.clip_name)}
          ${this.metaRow('VAE', item.vae_name, 'vae_name:' + item.vae_name)}
          ${lorasHTML}
          ${this.metaRow('Sampler', item.sampler, 'sampler:' + item.sampler)}
          ${this.metaRow('Scheduler', item.scheduler, 'scheduler:' + item.scheduler)}
          ${this.metaRow('Steps', item.steps, 'steps:' + item.steps)}
          ${this.metaRow('CFG', item.cfg_scale, null)}
          ${this.metaRow('Seed', item.seed, 'seed:' + item.seed)}
          ${this.metaRow('Dimensions', dims, null)}
          ${this.metaRow('File', item.filename, null)}
        </div>
        ${ppHTML}
        `;
    },

    attachPanelHandlers(container, item) {
      const copyBtn = container.querySelector('.gv-copy');
      if (copyBtn) copyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const val = copyBtn.getAttribute('data-value');
        if (navigator.clipboard) navigator.clipboard.writeText(val);
        copyBtn.innerHTML = '<i class="fa-solid fa-check"></i> Copied';
        setTimeout(() => { copyBtn.innerHTML = '<i class="fa-regular fa-clone"></i> Copy Prompt'; }, 1800);
      });

      container.querySelectorAll('.gv-filter').forEach(el => {
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          this.addHyperfilter(el.getAttribute('data-filter'), e);
        });
      });

      const tagInput = container.querySelector('.gv-add-tag');
      if (tagInput) tagInput.addEventListener('keydown', async (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault(); e.stopPropagation();
        const val = tagInput.value.trim();
        if (!val) return;
        await api.gallery.addTags([item.fingerprint], [val]);
        if (!item.tags.includes(val)) item.tags.push(val);
        tagInput.value = '';
        this.loadViewerPanel(item);
        this.refreshCard(item.fingerprint);
        this.refreshTags();
      });

      container.querySelectorAll('.gv-tag-remove').forEach(el => {
        el.addEventListener('click', async (e) => {
          e.stopPropagation();
          const tag = el.getAttribute('data-tag');
          await api.gallery.removeTags([item.fingerprint], [tag]);
          item.tags = item.tags.filter(t => t !== tag);
          this.loadViewerPanel(item);
          this.refreshCard(item.fingerprint);
          this.refreshTags();
        });
      });

      const openBtn = container.querySelector('.gv-open-folder');
      if (openBtn) openBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.openContainingFolder(item.fingerprint);
      });

      const trashBtn = container.querySelector('.gv-trash');
      if (trashBtn) trashBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.closeViewer();
        this.deleteItems([item.fingerprint]);
      });
    },

    addHyperfilter(fragment, event) {
      if (!fragment) return;
      if (event && (event.ctrlKey || event.metaKey)) {
        let base = (this.searchQuery || '').trim();
        base = base.replace(/\s*root_path:"[^"]*"/g, '').trim();
        base = base.replace(/\s*subfolder:"[^"]*"/g, '').trim();
        this.searchQuery = base ? (base + ' ' + fragment) : fragment;
      } else {
        this.searchQuery = fragment;
      }
      this.closeViewer();
      this.search(false);
    },

    // Sidebar tag click
    filterByTag(tag) {
      this.searchQuery = 'tag:' + tag;
      this.search(false);
    },

    // =========================================================
    // Video Viewer
    // =========================================================
    openVideoViewer(index) {
      this._viewerIndex = index;
      this._zoom = 1; this._panX = 0; this._panY = 0;
      this._panelHidden = !!this.settings.hidePanel;
      this.clearSelection();
      // Stop all card hover/locked playback
      document.querySelectorAll('.video-card-item video').forEach(v => { v.pause(); v.currentTime = 0; });
      this._buildVideoViewerOverlay();
      this._showVideo(index);

      this._keyHandler = (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        if (e.key === 'Escape') this._closeVideoViewer();
        else if (e.key === 'ArrowLeft') this._videoNav(-1);
        else if (e.key === 'ArrowRight') this._videoNav(1);
        else if (e.key === '+' || e.key === '=') this._videoZoomBy(0.25);
        else if (e.key === '-') this._videoZoomBy(-0.25);
        else if (e.key === '0') this._videoZoomReset();
        else if (e.key === ' ') { e.preventDefault(); this._videoTogglePlayback(); }
        else if (e.key.toLowerCase() === 'i') this.togglePanel();
        else if (e.key.toLowerCase() === 's') { e.preventDefault(); this._videoCaptureFrame(); }
        else if (e.key === '.') { e.preventDefault(); this._videoStepFrame(1); }
        else if (e.key === ',') { e.preventDefault(); this._videoStepFrame(-1); }
        else if (e.key.toLowerCase() === 'm') { e.preventDefault(); this._videoToggleMute(); }
      };
      document.addEventListener('keydown', this._keyHandler);
    },

    _buildVideoViewerOverlay() {
      this._closeVideoViewer(true);
      const overlay = document.createElement('div');
      overlay.className = 'gallery-viewer-overlay video-viewer';
      overlay.innerHTML = `
        <div class="gallery-viewer-main">
          <div class="gallery-viewer-image-area">
            <button class="gallery-viewer-nav gallery-viewer-prev" title="Previous (←)"><i class="fa-solid fa-chevron-left"></i></button>
            <div class="gallery-viewer-img-wrap"><video class="gallery-viewer-video" loop playsinline></video></div>
            <button class="gallery-viewer-nav gallery-viewer-next" title="Next (→)"><i class="fa-solid fa-chevron-right"></i></button>
          </div>
          <div class="gallery-viewer-toolbar">
            <span class="gallery-viewer-counter"></span>
            <span class="gv-sep"></span>
            <button class="gv-btn gv-vplay" title="Play/Pause (Space)"><i class="fa-solid fa-pause"></i></button>
            <button class="gv-btn gv-vprev-frame" title="Previous frame (,)"><i class="fa-solid fa-backward-step"></i></button>
            <button class="gv-btn gv-vnext-frame" title="Next frame (.)"><i class="fa-solid fa-forward-step"></i></button>
            <button class="gv-btn gv-vcapture" title="Capture frame (S)"><i class="fa-solid fa-camera"></i></button>
            <div class="gv-vseek-wrap">
              <span class="gv-vtime gv-vtime-current">0:00</span>
              <div class="gv-vseek">
                <div class="gv-vseek-buffered"></div>
                <div class="gv-vseek-progress"></div>
                <input class="gv-vseek-input" type="range" min="0" max="1000" value="0" step="1">
              </div>
              <span class="gv-vtime gv-vtime-duration">0:00</span>
            </div>
            <button class="gv-btn gv-vmute" title="Mute (M)"><i class="fa-solid fa-volume-high"></i></button>
            <input class="gv-vvolume" type="range" min="0" max="100" value="${this.videoVolume}" step="1">
            <span class="gv-sep"></span>
            <button class="gv-btn gv-zoom-out" title="Zoom out (−)"><i class="fa-solid fa-magnifying-glass-minus"></i></button>
            <button class="gv-btn gv-zoom-reset" title="Fit (0)"><i class="fa-solid fa-expand"></i></button>
            <button class="gv-btn gv-zoom-in" title="Zoom in (+)"><i class="fa-solid fa-magnifying-glass-plus"></i></button>
            <span class="gv-zoom-level">100%</span>
            <span class="gv-sep"></span>
            <button class="gv-btn gv-panel" title="Info (i)"><i class="fa-solid fa-circle-info"></i></button>
            <button class="gv-btn gv-close" title="Close (Esc)"><i class="fa-solid fa-xmark"></i></button>
          </div>
        </div>
        <div class="gallery-viewer-panel${this._panelHidden ? ' collapsed' : ''}"><div class="gv-panel-body"></div></div>
      `;
      document.body.appendChild(overlay);
      this._overlay = overlay;

      const $ = (s) => overlay.querySelector(s);
      $('.gallery-viewer-prev').addEventListener('click', (e) => { e.stopPropagation(); this._videoNav(-1); });
      $('.gallery-viewer-next').addEventListener('click', (e) => { e.stopPropagation(); this._videoNav(1); });
      $('.gv-vplay').addEventListener('click', (e) => { e.stopPropagation(); this._videoTogglePlayback(); });
      $('.gv-vprev-frame').addEventListener('click', (e) => { e.stopPropagation(); this._videoStepFrame(-1); });
      $('.gv-vnext-frame').addEventListener('click', (e) => { e.stopPropagation(); this._videoStepFrame(1); });
      $('.gv-vcapture').addEventListener('click', (e) => { e.stopPropagation(); this._videoCaptureFrame(); });
      $('.gv-vmute').addEventListener('click', (e) => { e.stopPropagation(); this._videoToggleMute(); });
      $('.gv-vvolume').addEventListener('input', (e) => { e.stopPropagation(); this._videoSetVolume(parseInt(e.target.value)); });
      $('.gv-vseek-input').addEventListener('input', (e) => { e.stopPropagation(); this._videoSeek(parseInt(e.target.value)); });
      $('.gv-zoom-in').addEventListener('click', (e) => { e.stopPropagation(); this._videoZoomBy(0.25); });
      $('.gv-zoom-out').addEventListener('click', (e) => { e.stopPropagation(); this._videoZoomBy(-0.25); });
      $('.gv-zoom-reset').addEventListener('click', (e) => { e.stopPropagation(); this._videoZoomReset(); });
      $('.gv-panel').addEventListener('click', (e) => { e.stopPropagation(); this.togglePanel(); });
      $('.gv-close').addEventListener('click', (e) => { e.stopPropagation(); this._closeVideoViewer(); });
      $('.gallery-viewer-panel').addEventListener('click', (e) => e.stopPropagation());
      $('.gallery-viewer-toolbar').addEventListener('click', (e) => e.stopPropagation());

      const area = $('.gallery-viewer-image-area');
      area.addEventListener('wheel', (e) => {
        e.preventDefault();
        this._videoZoomAtPoint(e.deltaY < 0 ? 0.15 : -0.15, e.clientX, e.clientY);
      }, { passive: false });

      const vidWrap = $('.gallery-viewer-img-wrap');
      let clickX, clickY, didDrag, clickTimer;
      area.addEventListener('mousedown', (e) => { if (e.target.closest('button')) return; clickX = e.clientX; clickY = e.clientY; didDrag = false; });
      vidWrap.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        this._isPanning = true;
        this._panStartX = e.clientX; this._panStartY = e.clientY;
        this._panOrigX = this._panX; this._panOrigY = this._panY;
        vidWrap.style.cursor = 'grabbing';
        e.preventDefault();
      });
      this._onPanMove = (e) => {
        if (!this._isPanning) return;
        const dx = e.clientX - this._panStartX, dy = e.clientY - this._panStartY;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) didDrag = true;
        this._panX = this._panOrigX + dx; this._panY = this._panOrigY + dy;
        this._videoApplyTransform();
      };
      this._onPanEnd = (e) => {
        if (this._isPanning) {
          this._isPanning = false;
          vidWrap.style.cursor = this._zoom > 1 ? 'grab' : 'default';
        }
        if (!didDrag && clickX !== undefined) {
          if (Math.abs(e.clientX - clickX) < 5 && Math.abs(e.clientY - clickY) < 5) {
            if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; this._closeVideoViewer(); }
            else clickTimer = setTimeout(() => { clickTimer = null; this._videoTogglePlayback(); }, 300);
          }
        }
        clickX = undefined;
      };
      document.addEventListener('mousemove', this._onPanMove);
      document.addEventListener('mouseup', this._onPanEnd);
    },

    _videoNav(dir) {
      const ni = this._viewerIndex + dir;
      if (ni < 0 || ni >= this.items.length) return;
      this._viewerIndex = ni;
      this._zoom = 1; this._panX = 0; this._panY = 0;
      this._showVideo(ni);
    },

    _showVideo(index) {
      const item = this.items[index];
      if (!item || !this._overlay) return;
      const video = this._overlay.querySelector('.gallery-viewer-video');
      if (video) {
        video.onplay = () => this._videoSyncPlay(false);
        video.onpause = () => this._videoSyncPlay(true);
        video.ontimeupdate = () => this._videoUpdateSeekUI();
        video.onprogress = () => this._videoUpdateSeekUI();
        video.onloadedmetadata = () => {
          this._videoUpdateSeekUI();
          const data = this.items[this._viewerIndex];
          if (data && data.fps) this.videoFps = data.fps;
        };
        video.onvolumechange = () => this._videoUpdateVolumeUI();
        const src = item.src || '/api/gallery/videos/file/' + encodeURIComponent(item.fingerprint);
        video.volume = this.videoVolume / 100;
        video.muted = false;
        video.src = src;
        // Play once the new source is buffered enough; calling play()
        // immediately after setting src can yield an AbortError.
        const doPlay = () => {
          video.play().catch(() => {
            video.addEventListener('canplay', () => video.play().catch(() => {}), { once: true });
          });
        };
        if (video.readyState >= 2) { doPlay(); }
        else { video.addEventListener('canplay', doPlay, { once: true }); }
      }
      this._videoSyncPlay(false);

      const label = `${index + 1} / ${this.items.length}`;
      const counter = this._overlay.querySelector('.gallery-viewer-counter');
      if (counter) counter.textContent = label;
      const prev = this._overlay.querySelector('.gallery-viewer-prev');
      const next = this._overlay.querySelector('.gallery-viewer-next');
      if (prev) prev.style.visibility = index > 0 ? 'visible' : 'hidden';
      if (next) next.style.visibility = index < this.items.length - 1 ? 'visible' : 'hidden';

      this._videoApplyTransform();
      this.updateZoomLabel();
      this._videoUpdateSeekUI();
      this._videoUpdateVolumeUI();
      this._videoLoadPanel(item);
    },

    // Video playback
    _videoTogglePlayback() {
      const v = this._overlay && this._overlay.querySelector('.gallery-viewer-video');
      if (!v) return;
      if (v.paused) v.play().catch(() => {});
      else v.pause();
    },
    _videoSyncPlay(paused) {
      const btn = this._overlay && this._overlay.querySelector('.gv-vplay i');
      if (btn) { btn.classList.toggle('fa-play', paused); btn.classList.toggle('fa-pause', !paused); }
    },
    _videoSeek(raw) {
      const v = this._overlay && this._overlay.querySelector('.gallery-viewer-video');
      if (!v || !isFinite(v.duration) || v.duration <= 0) return;
      v.currentTime = (raw / 1000) * v.duration;
      this._videoUpdateSeekUI();
    },
    _videoUpdateSeekUI() {
      const v = this._overlay && this._overlay.querySelector('.gallery-viewer-video');
      if (!v) return;
      const duration = isFinite(v.duration) ? v.duration : 0;
      const current = isFinite(v.currentTime) ? v.currentTime : 0;
      const input = this._overlay.querySelector('.gv-vseek-input');
      const progress = this._overlay.querySelector('.gv-vseek-progress');
      const buffered = this._overlay.querySelector('.gv-vseek-buffered');
      const currentLabel = this._overlay.querySelector('.gv-vtime-current');
      const durationLabel = this._overlay.querySelector('.gv-vtime-duration');
      const pct = duration > 0 ? Math.min(100, Math.max(0, (current / duration) * 100)) : 0;
      if (input) input.value = duration > 0 ? Math.round((current / duration) * 1000) : 0;
      if (progress) progress.style.width = `${pct}%`;
      if (buffered) {
        let bufPct = 0;
        if (duration > 0 && v.buffered && v.buffered.length) bufPct = Math.min(100, (v.buffered.end(v.buffered.length - 1) / duration) * 100);
        buffered.style.width = `${bufPct}%`;
      }
      if (currentLabel) currentLabel.textContent = this.formatClock(current);
      if (durationLabel) durationLabel.textContent = this.formatClock(duration);
    },
    _videoStepFrame(direction) {
      const v = this._overlay && this._overlay.querySelector('.gallery-viewer-video');
      if (!v) return;
      v.pause();
      const fps = Number(this.videoFps) > 0 ? Number(this.videoFps) : 30;
      const dur = isFinite(v.duration) ? v.duration : Number.MAX_SAFE_INTEGER;
      v.currentTime = Math.max(0, Math.min(dur, (v.currentTime || 0) + (direction / fps)));
      this._videoSyncPlay(true);
      this._videoUpdateSeekUI();
    },
    // Volume
    async _videoSetVolume(value) {
      const v = this._overlay && this._overlay.querySelector('.gallery-viewer-video');
      const vol = Math.max(0, Math.min(100, isNaN(value) ? this.videoVolume : value));
      this.videoVolume = vol;
      if (v) { v.volume = vol / 100; v.muted = vol === 0; }
      this._videoUpdateVolumeUI();
    },
    _videoToggleMute() {
      const v = this._overlay && this._overlay.querySelector('.gallery-viewer-video');
      if (!v) return;
      v.muted = !v.muted;
      this._videoUpdateVolumeUI();
    },
    _videoUpdateVolumeUI() {
      const v = this._overlay && this._overlay.querySelector('.gallery-viewer-video');
      const slider = this._overlay && this._overlay.querySelector('.gv-vvolume');
      const icon = this._overlay && this._overlay.querySelector('.gv-vmute i');
      if (slider) slider.value = this.videoVolume;
      if (!icon || !v) return;
      const level = v.muted || v.volume === 0 ? 'mute' : (v.volume < 0.5 ? 'low' : 'high');
      icon.className = level === 'mute' ? 'fa-solid fa-volume-xmark' : (level === 'low' ? 'fa-solid fa-volume-low' : 'fa-solid fa-volume-high');
    },
    // Frame capture
    _videoCaptureFrame() {
      const v = this._overlay && this._overlay.querySelector('.gallery-viewer-video');
      const item = this.items[this._viewerIndex];
      if (!v || !v.videoWidth || !v.videoHeight) return;
      const canvas = document.createElement('canvas');
      canvas.width = v.videoWidth; canvas.height = v.videoHeight;
      canvas.getContext('2d').drawImage(v, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/png');
      const base = (item.filename || item.fingerprint || 'video-frame').replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]+/g, '_');
      const now = v.currentTime || 0;
      const m = Math.floor(now / 60); const s = Math.floor(now % 60); const ms = Math.floor((now % 1) * 1000);
      const ts = `${m}-${String(s).padStart(2, '0')}-${String(ms).padStart(3, '0')}`;
      const filename = `${base}-${ts}.png`;

      api.gallery.videoCaptureFrame(dataUrl, filename).then(result => {
        if (result.saved) this._videoFlashCapture();
      }).catch(() => {
        const a = document.createElement('a'); a.href = dataUrl; a.download = filename; a.click();
      });
    },
    _videoFlashCapture() {
      const btn = this._overlay && this._overlay.querySelector('.gv-vcapture');
      if (!btn) return;
      btn.style.color = 'var(--success)';
      clearTimeout(this._captureTimer);
      this._captureTimer = setTimeout(() => { if (btn) btn.style.color = ''; }, 1200);
    },
    // Video zoom
    _videoZoomBy(delta) {
      this._zoom = Math.max(0.1, Math.min(20, this._zoom + delta));
      this._videoApplyTransform(); this.updateZoomLabel();
      const w = this._overlay && this._overlay.querySelector('.gallery-viewer-img-wrap');
      if (w) w.style.cursor = this._zoom > 1 ? 'grab' : 'default';
    },
    _videoZoomAtPoint(delta, cx, cy) {
      const w = this._overlay && this._overlay.querySelector('.gallery-viewer-img-wrap');
      if (!w) return;
      const r = w.getBoundingClientRect();
      const ox = cx - r.left - r.width / 2, oy = cy - r.top - r.height / 2;
      const oldZoom = this._zoom;
      this._zoom = Math.max(0.1, Math.min(20, this._zoom + delta));
      const scale = this._zoom / oldZoom;
      this._panX = ox - scale * (ox - this._panX);
      this._panY = oy - scale * (oy - this._panY);
      this._videoApplyTransform(); this.updateZoomLabel();
      if (w) w.style.cursor = this._zoom > 1 ? 'grab' : 'default';
    },
    _videoZoomReset() {
      this._zoom = 1; this._panX = 0; this._panY = 0;
      this._videoApplyTransform(); this.updateZoomLabel();
    },
    _videoApplyTransform() {
      const v = this._overlay && this._overlay.querySelector('.gallery-viewer-video');
      if (v) v.style.transform = `translate(${this._panX}px, ${this._panY}px) scale(${this._zoom})`;
    },
    // Video panel
    async _videoLoadPanel(item) {
      const body = this._overlay && this._overlay.querySelector('.gv-panel-body');
      if (!body) return;
      body.innerHTML = this._videoBuildPanelHTML(item);
      this._videoAttachPanelHandlers(body, item);
    },
    _videoBuildPanelHTML(item) {
      const tagsHTML = (item.tags || []).map(t =>
        `<span class="gv-tag"><span class="gv-filter" data-filter="tag:${this.escapeHTML(t)}">${this.escapeHTML(t)}</span><i class="fa-solid fa-xmark gv-tag-remove" data-tag="${this.escapeHTML(t)}"></i></span>`
      ).join('');
      const filenoext = (item.filename || '').replace(/\.[^.]+$/, '');
      return `
        <div class="gv-actions">
          <button class="gv-copy" data-value="${this.escapeHTML(filenoext)}"><i class="fa-regular fa-clone"></i> Copy Name</button>
        </div>
        <div class="gv-tags">${tagsHTML}
          <input type="text" class="gv-add-tag" placeholder="Add tag…">
        </div>
        <div class="gv-meta">
          ${this.metaRow('File', item.filename, null)}
          ${this.metaRow('Dimensions', (item.width && item.height) ? `${item.width} × ${item.height}` : '', null)}
          ${this.metaRow('Duration', item.duration ? this.formatDuration(item.duration) : '', 'duration:' + item.duration)}
          ${this.metaRow('FPS', item.fps ? Math.round(item.fps * 100) / 100 : '', null)}
          ${this.metaRow('Codec', item.video_codec, null)}
          ${this.metaRow('Size', item.size ? this.formatFileSize(item.size) : '', null)}
        </div>`;
    },
    formatFileSize(bytes) {
      if (!bytes || bytes === 0) return '0 B';
      const k = 1024, sizes = ['B', 'KB', 'MB', 'GB'], i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    },
    _videoAttachPanelHandlers(container, item) {
      const copyBtn = container.querySelector('.gv-copy');
      if (copyBtn) copyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const val = copyBtn.getAttribute('data-value');
        if (navigator.clipboard) navigator.clipboard.writeText(val);
        copyBtn.innerHTML = '<i class="fa-solid fa-check"></i> Copied';
        setTimeout(() => { copyBtn.innerHTML = '<i class="fa-regular fa-clone"></i> Copy Name'; }, 1800);
      });

      container.querySelectorAll('.gv-filter').forEach(el => {
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          this.addHyperfilter(el.getAttribute('data-filter'), e);
        });
      });

      const tagInput = container.querySelector('.gv-add-tag');
      if (tagInput) tagInput.addEventListener('keydown', async (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault(); e.stopPropagation();
        const val = tagInput.value.trim();
        if (!val) return;
        const addFn = this.mediaType === 'videos' ? api.gallery.videoAddTags : api.gallery.addTags;
        await addFn([item.fingerprint], [val]);
        if (!item.tags.includes(val)) item.tags.push(val);
        tagInput.value = '';
        this._videoLoadPanel(item);
        this.refreshCard(item.fingerprint);
        this.refreshTags();
      });

      container.querySelectorAll('.gv-tag-remove').forEach(el => {
        el.addEventListener('click', async (e) => {
          e.stopPropagation();
          const tag = el.getAttribute('data-tag');
          const removeFn = this.mediaType === 'videos' ? api.gallery.videoRemoveTags : api.gallery.removeTags;
          await removeFn([item.fingerprint], [tag]);
          item.tags = item.tags.filter(t => t !== tag);
          this._videoLoadPanel(item);
          this.refreshCard(item.fingerprint);
          this.refreshTags();
        });
      });
    },
    _closeVideoViewer(silent) {
      const video = this._overlay && this._overlay.querySelector('.gallery-viewer-video');
      if (video) video.pause();
      this.destroyViewerOverlay();
      if (!silent && this._keyHandler) { document.removeEventListener('keydown', this._keyHandler); this._keyHandler = null; }
      // Reset all play-locked cards
      document.querySelectorAll('.video-card-item.playing-locked').forEach(card => {
        card.classList.remove('playing-locked');
        const v = card.querySelector('video.video-hover') || card.querySelector('video.video-fallback');
        if (v) { v.pause(); v.currentTime = 0; v.muted = true; }
        const thumb = card.querySelector('img.video-thumb');
        const hv = card.querySelector('video.video-hover');
        if (thumb) { thumb.style.display = ''; if (hv) hv.style.display = ''; }
        const btn = card.querySelector('.g-play-lock i');
        if (btn) btn.className = 'fa-solid fa-play';
      });
    }
  }));
});
