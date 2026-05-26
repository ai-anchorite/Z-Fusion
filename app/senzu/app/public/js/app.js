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
    
    // File upload
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
          if (!document.fullscreenElement && !document.webkitFullscreenElement) {
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
      if (input) input.click();
    },
    
    handleFileChange(e) {
      const file = e.target.files[0];
      if (file) {
        this.inputFile = file;
        this.inputPreview = URL.createObjectURL(file);
        
        // Reset output when uploading a new file
        this.outputImage = null;
        this.editOutput = null;
        this.upscaleOutput = null;
      }
    },
    
    handleDrop(e) {
      const file = e.dataTransfer.files[0];
      if (file && file.type.startsWith('image/')) {
        this.inputFile = file;
        this.inputPreview = URL.createObjectURL(file);
        this.outputImage = null;
        this.editOutput = null;
        this.upscaleOutput = null;
        this.displayedImage = 'final';
      }
    },
    
    removeInput() {
      this.inputFile = null;
      if (this.inputPreview) URL.revokeObjectURL(this.inputPreview);
      this.inputPreview = null;
      this.outputImage = null;
      this.editOutput = null;
      this.upscaleOutput = null;
      this.displayedImage = 'final';
      this.zoomLevel = 1;
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
      if (e.deltaY < 0) {
        this.zoomLevel = Math.min(this.zoomLevel * 1.1, 5);
      } else {
        this.zoomLevel = Math.max(this.zoomLevel / 1.1, 0.25);
      }
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
    
    // Pipeline trigger
    async enhanceImage() {
      if (!this.inputFile) {
        alert('Please upload an image first.');
        return;
      }
      
      this.isProcessing = true;
      this.statusText = 'Initializing pipeline...';
      this.processTime = 0;
      
      this.processTimer = setInterval(() => {
        this.processTime++;
      }, 1000);
      
      try {
        const payload = JSON.parse(JSON.stringify(this.params));
        
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
        
        // Dynamic status mapping based on active steps
        const mode = payload.mode;
        
        if (mode === 'full' || mode === 'edit') {
          this.statusText = 'Uploading image and running Klein 9B Edit...';
        } else {
          this.statusText = 'Uploading image and running SeedVR2 Upscale...';
        }
        
        // Run enhance
        const res = await api.enhanceImage(this.inputFile, mode, payload);
        
        this.outputMode = res.mode;
        this.editOutput = res.editOutput || null;
        this.upscaleOutput = res.upscaleOutput || null;
        
        // Show final output by default
        if (this.upscaleOutput) {
          this.outputImage = this.upscaleOutput;
          this.displayedImage = 'final';
        } else if (this.editOutput) {
          this.outputImage = this.editOutput;
          this.displayedImage = 'edit';
        } else {
          this.outputImage = res.output;
          this.displayedImage = 'final';
        }
        
        this.statusText = 'Pipeline Completed successfully!';
        
      } catch (err) {
        this.statusText = 'Error: ' + err.message;
        alert('Enhancement failed:\n' + err.message);
      } finally {
        this.isProcessing = false;
        clearInterval(this.processTimer);
        this.processTimer = null;
      }
    },
    
    // Compute actual image display rect accounting for object-fit: contain letterboxing
    getImageDisplayRect() {
      const container = document.querySelector('.compare-container');
      if (!container) return null;
      const img = container.querySelector('.slider-img');
      if (!img || !img.naturalWidth) return null;

      const containerRect = container.getBoundingClientRect();
      const containerW = containerRect.width;
      const containerH = containerRect.height;
      const imgRatio = img.naturalWidth / img.naturalHeight;
      const containerRatio = containerW / containerH;

      let displayW, displayH, offsetX, offsetY;

      if (imgRatio > containerRatio) {
        displayW = containerW;
        displayH = containerW / imgRatio;
        offsetX = 0;
        offsetY = (containerH - displayH) / 2;
      } else {
        displayH = containerH;
        displayW = containerH * imgRatio;
        offsetX = (containerW - displayW) / 2;
        offsetY = 0;
      }

      return { displayW, displayH, offsetX, offsetY, containerW, containerH };
    },

    // Slider mouse/touch coordinate mappings
    getSliderStyle() {
      const info = this.getImageDisplayRect();
      if (!info) return `left: ${this.sliderPos}%`;
      const W = info.containerW;
      // Slider position in wrapper (pre-transform) coords
      const wx = info.offsetX + (this.sliderPos / 100) * info.displayW;
      // Forward zoom transform: wrapper coords -> container coords
      const vx = W / 2 + (wx + this.panX - W / 2) * this.zoomLevel;
      return `left: ${(vx / W) * 100}%`;
    },

    getAfterClipStyle() {
      const info = this.getImageDisplayRect();
      if (!info) return `clip-path: polygon(${this.sliderPos}% 0, 100% 0, 100% 100%, ${this.sliderPos}% 100%)`;
      // Clip-path is in img element's local coords (pre-transform wrapper space), no zoom adjustment needed
      const clipX = info.offsetX + (this.sliderPos / 100) * info.displayW;
      const pct = (clipX / info.containerW) * 100;
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

      const clientX = e.touches ? e.touches[0].clientX : e.clientX;

      const info = this.getImageDisplayRect();
      if (!info) {
        const rect = container.getBoundingClientRect();
        let pos = ((clientX - rect.left) / rect.width) * 100;
        if (pos < 0) pos = 0;
        if (pos > 100) pos = 100;
        this.sliderPos = pos;
        return;
      }

      const containerRect = container.getBoundingClientRect();
      const W = info.containerW;

      // Mouse position in container coordinates
      const vx = clientX - containerRect.left;

      // Inverse zoom transform: container coords -> wrapper (pre-transform) coords
      const wx = (vx - W / 2) / this.zoomLevel - this.panX + W / 2;

      // Map to image display area within wrapper
      const imgRelativeX = wx - info.offsetX;
      let pos = (imgRelativeX / info.displayW) * 100;

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
    
    formatTime(seconds) {
      const m = Math.floor(seconds / 60);
      const s = seconds % 60;
      return `${m}:${s < 10 ? '0' : ''}${s}`;
    }
  }));
});
