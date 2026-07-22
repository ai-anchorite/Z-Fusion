// Senzu Gallery — Alpine.js component.
// Grid rendering (manual innerHTML for performance), keyword search, live
// Socket.IO updates, fullscreen viewer with zoom/pan + metadata hyperfilters,
// multi-select, tagging and soft-delete/trash.

document.addEventListener('alpine:init', () => {
  Alpine.data('gallery', () => ({
    // --- Reactive state ---
    items: [],
    searchQuery: '',
    sortKey: 'btime',
    sortDir: -1,
    loading: false,
    hasMore: true,
    offset: 0,
    total: 0,
    tags: [],
    bookmarks: [],
    folders: [],
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

      await this.refreshTags();
      await this.loadBookmarks();
      await this.loadFolders();
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
        const res = await api.gallery.search(this.buildQueryParams(nextOffset));
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
    async loadBookmarks() {
      try { this.bookmarks = await api.gallery.favorites(); } catch (_) { this.bookmarks = []; }
    },

    async saveBookmark() {
      const q = this.searchQuery.trim();
      if (!q) { alert('Enter a search or filter first, then bookmark it.'); return; }
      const label = prompt('Bookmark label:', q);
      if (label === null) return;
      await api.gallery.addFavorite(q, label.trim() || q, false);
      await this.loadBookmarks();
    },

    applyBookmark(query) {
      this.searchQuery = query;
      this.search(false);
    },

    async deleteBookmark(id) {
      await api.gallery.removeFavorite(id);
      await this.loadBookmarks();
    },

    // --- Connected folders ---
    async loadFolders() {
      try { this.folders = await api.gallery.folders(); } catch (_) { this.folders = []; }
    },

    openFolders() {
      this.foldersOpen = !this.foldersOpen;
      if (this.foldersOpen) this.loadFolders();
    },

    async connectFolder() {
      if (this.connecting) return;
      this.connecting = true;
      try {
        const res = await api.gallery.pickFolder();
        if (res && res.path) {
          await this.addFolderPath(res.path);
        } else if (res && res.unavailable) {
          this.pickerUnavailable = true; // reveal manual path input
        }
        // cancelled → do nothing
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
        const res = await api.gallery.addFolder(folderPath, this.newFolderRecursive);
        if (res && res.folders) this.folders = res.folders;
        this.folderPathInput = '';
        await this.search(false);
      } catch (e) {
        alert('Could not connect folder: ' + e.message);
      } finally {
        this.connecting = false;
      }
    },

    async removeFolder(folderPath) {
      if (!confirm('Disconnect this folder and remove its images from the gallery index?\n\nYour image files are NOT deleted.')) return;
      try {
        const res = await api.gallery.removeFolder(folderPath);
        if (res && res.folders) this.folders = res.folders;
        await this.search(false);
      } catch (e) {
        alert('Could not remove folder: ' + e.message);
      }
    },

    async reindexFolder(folderPath) {
      try {
        await api.gallery.reindexFolder(folderPath);
        await this.loadFolders();
        await this.search(false);
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

      return `<div class="gallery-card${selected}" data-fp="${item.fingerprint}">
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

    renderGrid(appendItems) {
      const grid = this.$refs.grid;
      if (!grid) return;
      if (appendItems) {
        grid.insertAdjacentHTML('beforeend', appendItems.map(it => this.cardHTML(it)).join(''));
      } else {
        grid.innerHTML = this.items.map(it => this.cardHTML(it)).join('');
        if (this.$refs.gridScroll) this.$refs.gridScroll.scrollTop = 0;
      }
    },

    prependCard(item) {
      const grid = this.$refs.grid;
      if (!grid) return;
      grid.insertAdjacentHTML('afterbegin', this.cardHTML(item));
    },

    updateCard(item) {
      const grid = this.$refs.grid;
      if (!grid) return;
      const el = grid.querySelector(`.gallery-card[data-fp="${CSS.escape(item.fingerprint)}"]`);
      if (el) el.outerHTML = this.cardHTML(item);
    },

    removeCard(fp) {
      const grid = this.$refs.grid;
      if (!grid) return;
      const el = grid.querySelector(`.gallery-card[data-fp="${CSS.escape(fp)}"]`);
      if (el) el.remove();
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
        } else if (e.target.closest('img')) {
          const idx = this.items.findIndex(it => it.fingerprint === fp);
          if (idx >= 0) this.openViewer(idx);
        } else if (e.target.closest('.gallery-grab')) {
          this.toggleSelect(fp, card);
        }
      });
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
      const tag = prompt('Add tag to ' + this.selectedFps.length + ' selected image(s):');
      if (!tag || !tag.trim()) return;
      await api.gallery.addTags(this.selectedFps.slice(), [tag.trim()]);
      await this.refreshTags();
      // Update local items + card DOM.
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
      if (isFav) {
        await api.gallery.removeTags([fp], ['favorite']);
        it.tags = it.tags.filter(t => t !== 'favorite');
      } else {
        await api.gallery.addTags([fp], ['favorite']);
        it.tags.push('favorite');
      }
      // Update just the fav button.
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
        const msg = fps.length === 1
          ? 'Move this image to trash?'
          : `Move ${fps.length} images to trash?`;
        if (!confirm(msg)) return;
      }
      await api.gallery.delete(fps);
      for (const fp of fps) {
        this.removeCard(fp);
        this.items = this.items.filter(x => x.fingerprint !== fp);
        this.selectedFps = this.selectedFps.filter(x => x !== fp);
      }
      this.total = Math.max(0, this.total - fps.length);
    },

    async openContainingFolder(fp) {
      try { await api.gallery.openFolder(fp); } catch (e) { console.error('[Gallery] open folder failed:', e); }
    },

    async refreshTags() {
      try { this.tags = await api.gallery.tags(); } catch (_) {}
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
      area.addEventListener('mousedown', (e) => { clickX = e.clientX; clickY = e.clientY; didDrag = false; });
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
        this.closeViewer();
        window.dispatchEvent(new CustomEvent('senzu:route-image', { detail: { file, target } }));
      } catch (err) {
        alert('Failed to send image: ' + (err.message || err));
      }
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
      if (img) { img.src = item.src; this.applyViewerTransform(); }

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
    }
  }));
});
