document.addEventListener('alpine:init', () => {
  Alpine.data('senzu', () => ({
    // UI states
    activeTab: 'enhance',
    activeAccordion: 'edit',
    sidebarOpen: true,
    comfyOnline: false,
    isProcessing: false,
    processTime: 0,
    processTimer: null,
    statusText: 'Idle',
    
    // File upload — input queue
    imageQueue: [],           // { id, file, preview, name, status }
    outputQueue: [],          // { id, inputPreview, inputName, editOutput, upscaleOutput, mode }
    queueRunning: false,
    viewedIndex: 0,
    
    // Derived — kept for template compatibility
    inputFile: null,
    inputPreview: null,
    
    // Output assets
    outputImage: null,
    editOutput: null,
    upscaleOutput: null,
    outputMode: 'full',
    displayedImage: 'final',
    
    // Before/After slider
    sliderPos: 50,
    isDraggingSlider: false,
    
    // Zoom and pan
    zoomLevel: 1,
    panX: 0,
    panY: 0,
    isPanning: false,
    panStartX: 0,
    panStartY: 0,
    panOriginX: 0,
    panOriginY: 0,
    isFullscreen: false,
    
    // Model scan lists
    models: {
      diffusion_models: [],
      text_encoders: [],
      vae: [],
      loras: [],
      seedvr2: []
    },
    
    // Recommendations check list
    recommendedModels: {
      unet: { filename: 'flux-2-klein-9b-kv-fp8.safetensors', repo: 'Lytanshade/Flux2-Klein-9B', desc: 'Recommended Edit UNet (fp8)' },
      unet_gguf: { filename: 'flux-2-klein-9b-Q4_K_M.gguf', repo: 'city96/Flux-2-Klein-GGUF', desc: 'Recommended Edit UNet (Low VRAM GGUF)' },
      vae: { filename: 'flux2-vae.safetensors', repo: 'black-forest-labs/FLUX.1-schnell', desc: 'Recommended VAE' },
      clip: { filename: 'qwen_3_8b_fp8mixed.safetensors', repo: 'Lytanshade/Flux2-Klein-9B', desc: 'Recommended CLIP Text Encoder' },
      clip_gguf: { filename: 'Qwen3-4B-Q8_0.gguf', repo: 'city96/Flux-2-Klein-GGUF', desc: 'Recommended CLIP Text Encoder (Low VRAM)' },
      dit: { filename: 'seedvr2_ema_7b_fp8_e4m3fn_mixed_block35_fp16.safetensors', repo: 'Lytanshade/SeedVR2-Upscaler', desc: 'Recommended SeedVR2 Upscaler DiT' },
      seedvae: { filename: 'ema_vae_fp16.safetensors', repo: 'Lytanshade/SeedVR2-Upscaler', desc: 'Recommended SeedVR2 VAE' }
    },
    
    // Active downloads state
    downloadState: {
      filename: '',
      repo: '',
      progress: 0,
      speed: '0 B/s',
      downloaded: 0,
      total: 0,
      status: 'idle',
      error: null
    },
    downloadPollInterval: null,
    
    // Prompts and presets libraries
    promptsList: {},
    presetsList: {},
    newPresetName: '',
    newPromptName: '',
    newPromptContent: '',
    
    // Model packs
    modelPacksList: {},
    newPackName: '',
    presetToUpdate: '',
    
    // App settings
    appSettings: {
      save_folder: '',
      autosave: false,
      clear_temp_on_start: true,
      theme: 'Default'
    },
    
    // Core parameters mapping
    params: {
      mode: 'full',
      model_pack: 'FP8 Standard',
      unet_name: 'flux-2-klein-9b-kv-fp8.safetensors',
      clip_name: 'qwen_3_8b_fp8mixed.safetensors',
      vae_name: 'flux2-vae.safetensors',
      use_gguf: false,
      steps: 4,
      cfg: 1.0,
      megapixels: 1.0,
      sampler_name: 'euler',
      seed: 0,
      randomize_seed: true,
      prompt: '',
      negative_prompt: '',
      
      lora1_enabled: true,
      lora1_name: '_Flux_LoRA/Flux2_klein/klein9B_adonis_refine.safetensors',
      lora1_strength: 1.0,
      lora2_enabled: true,
      lora2_name: '_Flux_LoRA/Flux2_klein/Flux2-Klein-9B-consistency-V2.safetensors',
      lora2_strength: 0.5,
      lora3_enabled: false, lora3_name: 'none.safetensors', lora3_strength: 0,
      lora4_enabled: false, lora4_name: 'none.safetensors', lora4_strength: 0,
      lora5_enabled: false, lora5_name: 'none.safetensors', lora5_strength: 0,
      lora6_enabled: false, lora6_name: 'none.safetensors', lora6_strength: 0,
      
      dit_model: 'seedvr2_ema_7b_fp8_e4m3fn_mixed_block35_fp16.safetensors',
      blocks_to_swap: 36,
      attention_mode: 'flash_attn_2',
      color_correction: 'lab',
      resolution: 2048,
      max_resolution: 4096,
      max_input_resolution: 0,
      encode_tiled: true,
      encode_tile_size: 1024,
      encode_tile_overlap: 128,
      decode_tiled: true,
      decode_tile_size: 1024,
      decode_tile_overlap: 128,
      batch_size: 1,
      uniform_batch_size: false,
      temporal_overlap: 0,
      input_noise_scale: 0.0,
      latent_noise_scale: 0.0,
      offload_device: 'cpu'
    },
    
    init() {
      try {
        this.checkStatus();
        this.loadPresets();
        this.loadPrompts();
        this.loadModels();
        this.loadModelPacks();
        this.loadSettings();
        
        setInterval(() => this.checkStatus(), 5000);
        this.pollDownloadStatus();
        
        // Global slider drag: continue tracking even when cursor leaves container
        document.addEventListener('mousemove', (e) => {
          if (this.isDraggingSlider) this.updateSliderPos(e);
        });
        document.addEventListener('touchmove', (e) => {
          if (this.isDraggingSlider) this.updateSliderPos(e);
        }, { passive: true });
        document.addEventListener('mouseup', () => { this.stopSliderDrag(); });
        document.addEventListener('touchend', () => { this.stopSliderDrag(); });
        
        // Reset zoom on exiting fullscreen (also catches ESC key)
        const onFullscreenChange = () => {
          const fs = !!(document.fullscreenElement || document.webkitFullscreenElement);
          this.isFullscreen = fs;
          if (!fs) {
            this.resetZoom();
          }
        };
        document.addEventListener('fullscreenchange', onFullscreenChange);
        document.addEventListener('webkitfullscreenchange', onFullscreenChange);

        // Register wheel zoom (avoids @wheel.prevent compat issues)
        const container = document.querySelector('.compare-container');
        if (container) {
          container.addEventListener('wheel', (e) => {
            e.preventDefault();
            this.handleZoom(e);
          }, { passive: false });
        }
      } catch (e) {
        console.error('Init error:', e);
      }
    },
    
    async checkStatus() {
      try {
        const data = await api.getStatus();
        this.comfyOnline = data.comfyOnline;
      } catch (err) {
        this.comfyOnline = false;
      }
    },
    
    async loadPresets() {
      try {
        this.presetsList = await api.getPresets();
        // Set default prompt preset on launch if not set
        if (this.presetsList['Default'] && this.params.prompt === '') {
          this.applyPreset('Default');
        }
      } catch (err) {
        console.error('Failed to load presets:', err);
      }
    },
    
    async loadPrompts() {
      try {
        this.promptsList = await api.getPrompts();
      } catch (err) {
        console.error('Failed to load prompts:', err);
      }
    },
    
    async loadModels() {
      try {
        this.models = await api.getModels();
      } catch (err) {
        console.error('Failed to scan models:', err);
      }
    },
    
    applyPreset(name) {
      if (this.presetsList[name]) {
        const p = this.presetsList[name];
        // Merge preset values into active params
        Object.keys(p).forEach(key => {
          if (this.params[key] !== undefined) {
            this.params[key] = p[key];
          }
        });
        
        // Auto-select GGUF toggles if models match GGUF in preset
        if (this.params.unet_name.includes('.gguf')) {
          this.params.use_gguf = true;
        } else {
          this.params.use_gguf = false;
        }
      }
    },
    
    async saveNewPreset() {
      if (!this.newPresetName.trim()) return;
      try {
        const payload = JSON.parse(JSON.stringify(this.params));
        await api.savePreset(this.newPresetName, payload);
        this.newPresetName = '';
        await this.loadPresets();
      } catch (err) {
        alert('Failed to save preset: ' + err.message);
      }
    },
    
    async deletePreset(name) {
      if (name === 'Default') {
        alert('Cannot delete the Default preset.');
        return;
      }
      if (!confirm(`Are you sure you want to delete preset "${name}"?`)) return;
      try {
        await api.deletePreset(name);
        await this.loadPresets();
      } catch (err) {
        alert('Failed to delete preset: ' + err.message);
      }
    },
    
    applyPrompt(name) {
      if (this.promptsList[name]) {
        this.params.prompt = this.promptsList[name];
      }
    },
    
    async saveNewPrompt() {
      if (!this.newPromptName.trim() || !this.newPromptContent.trim()) return;
      try {
        await api.savePrompt(this.newPromptName, this.newPromptContent);
        this.newPromptName = '';
        this.newPromptContent = '';
        await this.loadPrompts();
      } catch (err) {
        alert('Failed to save prompt: ' + err.message);
      }
    },
    
    async deletePrompt(name) {
      if (!confirm(`Are you sure you want to delete prompt "${name}"?`)) return;
      try {
        await api.deletePrompt(name);
        await this.loadPrompts();
      } catch (err) {
        alert('Failed to delete prompt: ' + err.message);
      }
    },
    
    async resetPrompts() {
      if (!confirm('Are you sure you want to reset prompts library to defaults? All custom prompts will be lost.')) return;
      try {
        const res = await api.resetPrompts();
        this.promptsList = res.prompts;
      } catch (err) {
        alert('Failed to reset prompts: ' + err.message);
      }
    },
    
    // Model Packs management
    async loadModelPacks() {
      try {
        this.modelPacksList = await api.getModelPacks();
      } catch (err) {
        console.error('Failed to load model packs:', err);
      }
    },
    
    applyModelPack(name) {
      const pack = this.modelPacksList[name];
      if (!pack) return;
      this.params.model_pack = name;
      this.params.use_gguf = pack.use_gguf;
      this.params.unet_name = pack.unet_name;
      this.params.clip_name = pack.clip_name;
      this.params.vae_name = pack.vae_name;
    },
    
    packModelsInstalled(pack) {
      if (!pack) return false;
      return this.modelExists(pack.unet_name, 'diffusion_models') &&
             this.modelExists(pack.clip_name, 'text_encoders') &&
             this.modelExists(pack.vae_name, 'vae');
    },
    
    async saveModelPack() {
      if (!this.newPackName.trim()) return;
      const data = {
        use_gguf: this.params.use_gguf,
        unet_name: this.params.unet_name,
        clip_name: this.params.clip_name,
        vae_name: this.params.vae_name,
        is_recommended: false
      };
      try {
        await api.saveModelPack(this.newPackName.trim(), data);
        this.newPackName = '';
        await this.loadModelPacks();
      } catch (err) {
        alert('Failed to save model pack: ' + err.message);
      }
    },
    
    async deleteModelPack(name) {
      if (!confirm(`Delete model pack "${name}"?`)) return;
      try {
        await api.deleteModelPack(name);
        await this.loadModelPacks();
      } catch (err) {
        alert('Failed to delete model pack: ' + err.message);
      }
    },
    
    async downloadPackModel(packName, modelType) {
      const pack = this.modelPacksList[packName];
      if (!pack || !pack.downloads || !pack.downloads[modelType]) return;
      const dl = pack.downloads[modelType];
      try {
        await api.startDownload(dl.repo, dl.filename, modelType === 'vae' ? 'vae' : (modelType === 'clip' ? 'text_encoder' : 'unet'));
        this.pollDownloadStatus();
      } catch (err) {
        alert('Download error: ' + err.message);
      }
    },
    
    async downloadPack(packName) {
      const pack = this.modelPacksList[packName];
      if (!pack || !pack.downloads) return;
      if (!confirm(`Download ALL models for "${packName}"? This may take a while.`)) return;
      
      const types = ['unet', 'clip', 'vae'];
      for (const type of types) {
        const dl = pack.downloads[type];
        if (!dl) continue;
        const category = type === 'vae' ? 'vae' : (type === 'clip' ? 'text_encoders' : 'diffusion_models');
        if (this.modelExists(dl.filename, category)) continue;
        try {
          const res = await api.startDownload(dl.repo, dl.filename, type === 'vae' ? 'vae' : (type === 'clip' ? 'text_encoder' : 'unet'));
          this.pollDownloadStatus();
          while (this.downloadState.status === 'downloading') {
            await new Promise(r => setTimeout(r, 500));
          }
        } catch (err) {
          alert(`Download failed for ${dl.filename}: ${err.message}`);
        }
      }
    },
    
    // Preset update (overwrite existing)
    async updatePreset() {
      if (!this.presetToUpdate) return;
      if (!confirm(`Overwrite preset "${this.presetToUpdate}" with current settings?`)) return;
      try {
        const payload = JSON.parse(JSON.stringify(this.params));
        await api.savePreset(this.presetToUpdate, payload);
        this.presetToUpdate = '';
        await this.loadPresets();
      } catch (err) {
        alert('Failed to update preset: ' + err.message);
      }
    },
    
    toggleAccordion(name) {
      this.activeAccordion = this.activeAccordion === name ? '' : name;
    },
    
    toggleSidebar() {
      this.sidebarOpen = !this.sidebarOpen;
    },
    
    // File selection handling
    triggerFileSelect() {
      const input = document.querySelector('input[type="file"][accept="image/*"]');
      if (input) { input.value = ''; input.click(); }
    },
    
    handleFileChange(e) {
      if (e.target.files && e.target.files.length > 0) {
        this.addToQueue(Array.from(e.target.files));
      }
    },
    
    handleDrop(e) {
      const dt = e.dataTransfer;
      if (!dt || !dt.files || dt.files.length === 0) return;
      this.addToQueue(Array.from(dt.files));
    },
    
    addToQueue(files) {
      const items = [];
      for (const file of files) {
        if (!file.type.startsWith('image/')) continue;
        items.push({
          id: crypto.randomUUID(),
          file: file,
          preview: URL.createObjectURL(file),
          name: file.name,
          status: 'pending',
          size: this.formatFileSize(file.size)
        });
      }
      if (items.length === 0) return;
      
      const wasEmpty = this.imageQueue.length === 0 && !this.inputPreview;
      this.imageQueue.push(...items);
      
      // If nothing is being processed or viewed, load first item
      if (wasEmpty || (!this.inputPreview && !this.queueRunning)) {
        this.setActiveInput(this.imageQueue[0]);
      }
    },
    
    removeFromQueue(idx) {
      const item = this.imageQueue[idx];
      if (!item) return;
      if (item.status === 'processing') return;
      
      if (item.preview) URL.revokeObjectURL(item.preview);
      this.imageQueue.splice(idx, 1);
      
      // If this was the active input, switch to next pending
      if (this.inputPreview === item.preview || this.imageQueue.length === 0) {
        const pending = this.imageQueue.find(i => i.status === 'pending');
        if (pending) {
          this.setActiveInput(pending);
        } else if (this.outputQueue.length > 0) {
          this.loadOutputView(this.viewedIndex);
        } else {
          this.clearViewer();
        }
      }
    },
    
    setActiveInput(item) {
      this.inputFile = item.file;
      this.inputPreview = item.preview;
      this.outputImage = null;
      this.editOutput = null;
      this.upscaleOutput = null;
      this.displayedImage = 'final';
      this.sliderPos = 50;
    },
    
    clearViewer() {
      if (this.inputPreview) URL.revokeObjectURL(this.inputPreview);
      this.inputFile = null;
      this.inputPreview = null;
      this.outputImage = null;
      this.editOutput = null;
      this.upscaleOutput = null;
      this.displayedImage = 'final';
      this.zoomLevel = 1;
    },
    
    removeInput() {
      // Legacy hook — clears queue entirely
      for (const item of this.imageQueue) {
        if (item.preview) URL.revokeObjectURL(item.preview);
      }
      this.imageQueue = [];
      this.clearViewer();
    },
    
    // Zoom controls
    updatePanCursor() {
      const c = document.querySelector('.compare-container');
      if (c) c.classList.toggle('pan-mode', this.zoomLevel > 1);
    },
    
    zoomIn() {
      this.zoomLevel = Math.min(this.zoomLevel * 1.2, 5);
      this.updatePanCursor();
    },
    
    zoomOut() {
      this.zoomLevel = Math.max(this.zoomLevel / 1.2, 0.25);
      this.updatePanCursor();
    },
    
    resetZoom() {
      this.zoomLevel = 1;
      this.panX = 0;
      this.panY = 0;
      this.updatePanCursor();
    },
    
    handleZoom(e) {
      const container = document.querySelector('.compare-container');
      if (!container) return;
      
      const oldZoom = this.zoomLevel;
      const newZoom = e.deltaY < 0
        ? Math.min(oldZoom * 1.1, 5)
        : Math.max(oldZoom / 1.1, 0.25);
      
      // Zoom toward mouse cursor position
      const rect = container.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const ratio = (1 / newZoom) - (1 / oldZoom);
      this.panX += (mx - rect.width / 2) * ratio;
      this.panY += (my - rect.height / 2) * ratio;
      
      this.zoomLevel = newZoom;
      this.updatePanCursor();
    },
    
    getZoomStyle() {
      return `transform: scale(${this.zoomLevel}) translate(${this.panX}px, ${this.panY}px)`;
    },
    
    toggleFullscreen() {
      const el = document.querySelector('.compare-container');
      if (!el) return;
      const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
      if (!fsEl) {
        if (el.requestFullscreen) {
          el.requestFullscreen().catch(() => {});
        } else if (el.webkitRequestFullscreen) {
          el.webkitRequestFullscreen();
        }
      } else {
        if (document.exitFullscreen) {
          document.exitFullscreen().catch(() => {});
        } else if (document.webkitExitFullscreen) {
          document.webkitExitFullscreen();
        }
      }
    },
    
    // Pan handling (left-click grab, only when zoomed)
    startPan(e) {
      if (e.button !== 0 || this.zoomLevel <= 1) return;
      e.preventDefault();
      this.isPanning = true;
      this.panStartX = e.clientX;
      this.panStartY = e.clientY;
      this.panOriginX = this.panX;
      this.panOriginY = this.panY;
    },
    
    doPan(e) {
      if (!this.isPanning) return;
      e.preventDefault();
      this.panX = this.panOriginX + (e.clientX - this.panStartX);
      this.panY = this.panOriginY + (e.clientY - this.panStartY);
    },
    
    onMouseMove(e) {
      if (this.isDraggingSlider) {
        this.updateSliderPos(e);
        return;
      }
      if (this.isPanning) {
        e.preventDefault();
        this.panX = this.panOriginX + (e.clientX - this.panStartX);
        this.panY = this.panOriginY + (e.clientY - this.panStartY);
      }
    },
    
    stopPan() {
      this.isPanning = false;
    },
    
    // Show specific output
    showOutput(type) {
      this.displayedImage = type;
      if (type === 'edit' && this.editOutput) {
        this.outputImage = this.editOutput;
      } else if (type === 'final' && this.upscaleOutput) {
        this.outputImage = this.upscaleOutput;
      } else if (type === 'original') {
        this.outputImage = null;
      }
      this.sliderPos = 50;
    },
    
    // HF Model Downloader
    async triggerDownload(repo, filename, type) {
      try {
        const res = await api.startDownload(repo, filename, type);
        this.pollDownloadStatus();
      } catch (err) {
        alert('Download error: ' + err.message);
      }
    },
    
    pollDownloadStatus() {
      if (this.downloadPollInterval) clearInterval(this.downloadPollInterval);
      
      this.downloadPollInterval = setInterval(async () => {
        try {
          const state = await api.getDownloadStatus();
          this.downloadState = state;
          
          if (state.status === 'completed' || state.status === 'error' || state.status === 'idle') {
            if (state.status === 'completed') {
              this.loadModels(); // Refresh available models
            }
            clearInterval(this.downloadPollInterval);
            this.downloadPollInterval = null;
          }
        } catch (err) {
          console.error('Error polling download status:', err);
        }
      }, 1000);
    },
    
    // Verification of model files on local system
    modelExists(filename, category) {
      const files = this.models[category] || [];
      return files.some(f => f.toLowerCase().includes(filename.toLowerCase()));
    },
    
    // Output queue navigation
    loadOutputView(idx) {
      const entry = this.outputQueue[idx];
      if (!entry) return;
      this.viewedIndex = idx;
      this.inputPreview = entry.inputPreview;
      this.inputFile = null;
      this.outputImage = entry.upscaleOutput || entry.editOutput;
      this.editOutput = entry.editOutput;
      this.upscaleOutput = entry.upscaleOutput;
      this.outputMode = entry.mode;
      this.displayedImage = entry.upscaleOutput ? 'final' : 'edit';
      this.sliderPos = 50;
    },

    nextOutput() {
      if (this.viewedIndex < this.outputQueue.length - 1) {
        this.loadOutputView(this.viewedIndex + 1);
      }
    },

    prevOutput() {
      if (this.viewedIndex > 0) {
        this.loadOutputView(this.viewedIndex - 1);
      }
    },

    discardCurrentOutput() {
      if (this.outputQueue.length === 0) return;
      const entry = this.outputQueue[this.viewedIndex];
      if (entry && entry.inputPreview) URL.revokeObjectURL(entry.inputPreview);
      this.outputQueue.splice(this.viewedIndex, 1);
      if (this.outputQueue.length === 0) {
        this.clearViewer();
        this.statusText = 'Idle';
      } else {
        this.viewedIndex = Math.min(this.viewedIndex, this.outputQueue.length - 1);
        this.loadOutputView(this.viewedIndex);
      }
    },

    // Queue processor
    async startQueue() {
      const pending = this.imageQueue.findIndex(i => i.status === 'pending');
      if (pending === -1) return;
      
      this.queueRunning = true;
      this.isProcessing = true;
      this.processTime = 0;
      
      if (this.processTimer) clearInterval(this.processTimer);
      this.processTimer = setInterval(() => { this.processTime++; }, 1000);
      
      const payload = JSON.parse(JSON.stringify(this.params));
      payload.save_folder = this.appSettings.save_folder;
      payload.autosave = this.appSettings.autosave;
      
      // Auto-overwrite model selection based on GGUF flag if not edited
      if (payload.use_gguf) {
        if (payload.unet_name === 'flux-2-klein-9b-kv-fp8.safetensors') {
          payload.unet_name = 'flux-2-klein-9b-Q4_K_M.gguf';
        }
        if (payload.clip_name === 'qwen_3_8b_fp8mixed.safetensors') {
          payload.clip_name = 'Qwen3-4B-Q8_0.gguf';
        }
      } else {
        if (payload.unet_name === 'flux-2-klein-9b-Q4_K_M.gguf') {
          payload.unet_name = 'flux-2-klein-9b-kv-fp8.safetensors';
        }
        if (payload.clip_name === 'Qwen3-4B-Q8_0.gguf') {
          payload.clip_name = 'qwen_3_8b_fp8mixed.safetensors';
        }
      }
      
      const mode = payload.mode;
      
      while (true) {
        const idx = this.imageQueue.findIndex(i => i.status === 'pending');
        if (idx === -1) break;
        
        const item = this.imageQueue[idx];
        item.status = 'processing';
        
        // Only populate viewer with input if no output is already showing
        this.inputFile = item.file;
        if (this.outputQueue.length === 0) {
          this.setActiveInput(item);
        }
        const total = this.imageQueue.filter(i => i.status !== 'done' && i.status !== 'error').length + this.outputQueue.length;
        const done = this.outputQueue.length;
        this.statusText = done > 0
          ? `Processing (${done + 1}/${total}): ${item.name}`
          : `Processing: ${item.name}`;
        
        try {
          const res = await api.enhanceImage(item.file, mode, payload);
          item.status = 'done';
          
          // Push to output queue
          this.outputQueue.push({
            id: item.id,
            inputPreview: item.preview,
            inputName: item.name,
            editOutput: res.editOutput || null,
            upscaleOutput: res.upscaleOutput || null,
            mode: res.mode
          });
          
          // Auto-show if first output
          if (this.outputQueue.length === 1) {
            this.viewedIndex = 0;
            this.loadOutputView(0);
          }
          
          const stillPending = this.imageQueue.filter(i => i.status === 'pending').length;
          this.statusText = stillPending > 0
            ? `${this.outputQueue.length} complete, ${stillPending} remaining`
            : `${this.outputQueue.length} image${this.outputQueue.length !== 1 ? 's' : ''} processed`;
        } catch (err) {
          item.status = 'error';
          item.error = err.message;
          this.statusText = this.outputQueue.length > 0
            ? `${item.name} failed: ${err.message}`
            : 'Error: ' + err.message;
          if (this.outputQueue.length === 0) {
            alert('Enhancement failed:\n' + err.message);
          } else {
            this.loadOutputView(this.viewedIndex);
          }
        }
        
        // Remove processed item from queue
        const inOutputQueue = this.outputQueue.some(o => o.inputPreview === item.preview);
        if (item.preview !== this.inputPreview && !inOutputQueue) {
          URL.revokeObjectURL(item.preview);
        }
        this.imageQueue.splice(idx, 1);
        
        if (this.imageQueue.length === 0 && this.outputQueue.length === 0) {
          this.clearViewer();
        }
      }
      
      this.isProcessing = false;
      this.queueRunning = false;
      clearInterval(this.processTimer);
      this.processTimer = null;
      if (this.statusText.indexOf('Error:') === -1) {
        this.statusText = this.outputQueue.length > 0 
          ? `Done: ${this.outputQueue.length} image${this.outputQueue.length !== 1 ? 's' : ''}`
          : 'Idle';
      }
    },
    
    stopQueue() {
      // Mark all pending items as cancelled
      for (const item of this.imageQueue) {
        if (item.status === 'pending') item.status = 'done';
      }
      this.queueRunning = false;
    },
    
    hasPendingImages() {
      return this.imageQueue.some(i => i.status === 'pending');
    },
    
    formatFileSize(bytes) {
      if (bytes < 1024) return bytes + ' B';
      if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
      return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    },
    
    // Slider: fixed to container window (industry-standard approach)
    getSliderStyle() {
      return `left: ${this.sliderPos}%`;
    },

    getAfterClipStyle() {
      const container = document.querySelector('.compare-container');
      if (!container) return `clip-path: polygon(${this.sliderPos}% 0, 100% 0, 100% 100%, ${this.sliderPos}% 100%)`;
      const W = container.getBoundingClientRect().width;
      // Container-relative slider position
      const vx = (this.sliderPos / 100) * W;
      // Inverse zoom: container coords -> wrapper (pre-transform) coords
      const wx = (vx - W / 2) / this.zoomLevel - this.panX + W / 2;
      // Clip-path is in img element's local coords (pre-transform), as percentage of element width
      const pct = (wx / W) * 100;
      return `clip-path: polygon(${pct}% 0, 100% 0, 100% 100%, ${pct}% 100%)`;
    },

    startSliderDrag(e) {
      this.isDraggingSlider = true;
      this.updateSliderPos(e);
    },

    stopSliderDrag() {
      this.isDraggingSlider = false;
    },

    dragSlider(e) {
      if (this.isDraggingSlider) {
        this.updateSliderPos(e);
      }
    },

    updateSliderPos(e) {
      const container = document.querySelector('.compare-container');
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      let pos = ((clientX - rect.left) / rect.width) * 100;
      if (pos < 0) pos = 0;
      if (pos > 100) pos = 100;
      this.sliderPos = pos;
    },
    
    downloadOutput(type) {
      let url = null;
      let label = 'senzu';
      if (type === 'edit' && this.editOutput) {
        url = this.editOutput;
        label = 'senzu_edit';
      } else if (type === 'final' && this.upscaleOutput) {
        url = this.upscaleOutput;
        label = 'senzu_upscaled';
      } else if (this.outputImage) {
        url = this.outputImage;
        label = 'senzu_result';
      }
      if (!url) return;
      const a = document.createElement('a');
      a.href = url;
      a.download = `${label}_${Date.now()}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    },
    
    // App Settings
    async loadSettings() {
      try {
        const s = await api.getSettings();
        if (s && typeof s === 'object') {
          this.appSettings.save_folder = s.save_folder || '';
          this.appSettings.autosave = s.autosave || false;
          this.appSettings.clear_temp_on_start = s.clear_temp_on_start !== false;
          this.appSettings.theme = s.theme || 'Default';
        }
      } catch (err) {
        console.error('Failed to load settings:', err);
      }
    },
    
    async saveSettings() {
      try {
        await api.saveSettings({
          save_folder: this.appSettings.save_folder,
          autosave: this.appSettings.autosave,
          clear_temp_on_start: this.appSettings.clear_temp_on_start,
          theme: this.appSettings.theme
        });
      } catch (err) {
        alert('Failed to save settings: ' + err.message);
      }
    },
    
    async openOutputs() {
      try {
        const folder = this.appSettings.save_folder || '';
        await api.openOutputs(folder);
      } catch (err) {
        alert('Failed to open folder: ' + err.message);
      }
    },
    
    async clearTempOutputs() {
      if (!confirm('Clear all temporary output files?')) return;
      try {
        const res = await api.clearTempOutputs();
        if (res.success) {
          this.outputImage = null;
          this.editOutput = null;
          this.upscaleOutput = null;
        }
      } catch (err) {
        alert('Failed to clear temp: ' + err.message);
      }
    },
    
    async downloadOutput(type) {
      let url = null;
      let filename = null;
      let label = 'senzu';
      if (type === 'edit' && this.editOutput) {
        url = this.editOutput;
        filename = url.split('/').pop();
        label = 'senzu_edit';
      } else if (type === 'final' && this.upscaleOutput) {
        url = this.upscaleOutput;
        filename = url.split('/').pop();
        label = 'senzu_upscaled';
      } else if (this.outputImage) {
        url = this.outputImage;
        filename = url.split('/').pop();
        label = 'senzu_result';
      }
      if (!url || !filename) return;
      
      // Server-side save if folder configured, else browser download
      const saveFolder = this.appSettings.save_folder;
      if (saveFolder && saveFolder.trim()) {
        try {
          await api.saveOutputToFolder(filename, saveFolder);
          return;
        } catch (err) {
          alert('Failed to save to folder: ' + err.message);
        }
      }
      
      // Fallback: browser download
      const a = document.createElement('a');
      a.href = url;
      a.download = `${label}_${Date.now()}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    },
    
    formatTime(seconds) {
      const m = Math.floor(seconds / 60);
      const s = seconds % 60;
      return `${m}:${s < 10 ? '0' : ''}${s}`;
    }
  }));
});
