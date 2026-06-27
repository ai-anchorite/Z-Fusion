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

    // System monitor
    sysStats: { gpu: null, ram: { used: 0, total: 0 }, available: false },
    
    // File upload — input queue
    imageQueue: [],           // { id, file, preview, name, status }
    outputQueue: [],          // { id, inputPreview, inputName, editOutput, upscaleOutput, mode }
    queueRunning: false,
    viewedIndex: 0,
    currentInputName: '',
    lastSavedType: '',
    
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
    showModelNag: false,
    
    // Model packs
    modelPacksList: {},
    newPackName: '',
    presetToUpdate: '',
    
    // App settings
    appSettings: {
      save_folder: '',
      autosave: false,
      clear_temp_on_start: true,
      theme: 'Default',
      default_model_pack: ''
    },

    // Krea2 Image Generation
    genParams: {
      prompt: '',
      enable_prompt_enhancer: true,
      width: 1024,
      height: 1024,
      base_size: 1024,
      selected_res: '1024x1024 ( 1:1 )',
      unet_name: 'krea2_turbo_fp8_scaled.safetensors',
      vae_name: 'qwen_image_vae.safetensors',
      clip_name: 'qwen3vl_4b_fp8_scaled.safetensors',
      steps: 8,
      cfg: 1.0,
      sampler_name: 'euler',
      scheduler: 'beta',
      seed: 0,
      randomize_seed: true,
      lora1_enabled: false, lora1_name: 'none.safetensors', lora1_strength: 0,
      lora2_enabled: false, lora2_name: 'none.safetensors', lora2_strength: 0,
      lora3_enabled: false, lora3_name: 'none.safetensors', lora3_strength: 0,
      lora4_enabled: false, lora4_name: 'none.safetensors', lora4_strength: 0,
      lora5_enabled: false, lora5_name: 'none.safetensors', lora5_strength: 0,
      lora6_enabled: false, lora6_name: 'none.safetensors', lora6_strength: 0,
      system_prompt: `You are an expert prompt engineer for text-to-image models. Your task is to expand the user's prompt into a highly effective image-generation prompt.\n\nThink step by step about the request before writing the answer:\n- What is the subject and mood?\n- What visual styles, mediums, and lighting options would fit? Consider two or three alternatives and pick the one that best serves the caption.\n- What composition, framing, and grounded details will help the text-to-image model?\n\nThen output a single expanded prompt paragraph.\n\nFollow these rules strictly:\n1. **Faithfulness First:** Preserve all original subjects, actions, colors, and spatial relationships. Do not add new objects, props, characters, or animals unless the user clearly implies them.\n2. **Practical T2I Structure:** Write a prompt that a text-to-image model can parse cleanly. Group subjects with their own attributes and actions. Use grounded phrasing for poses, interactions, and spatial layout.\n3. **Style Planning Stays Internal:** Use your internal reasoning to choose style, medium, framing, and lighting. Do not emit planning tags or wrappers in the visible answer body.\n4. **Text Rendering:** If the user requests visible text, quotes, labels, or typography, specify the exact text clearly and wrap requested words in quotes.\n5. **Avoid Over-Specification:** Do not invent highly specific clothing, colors, materials, or scene details unless the input supports them.\n6. **Structure:** Write one cohesive paragraph after the thinking block. No bullets, JSON, or markdown.\n7. **Respect Existing Detail:** If the user's prompt is already detailed, lightly polish and finalize rather than heavily expanding \u2014 preserve their phrasing and direction.\n8. **Preserve User Medium:** When the user explicitly requests a medium (e.g. \"photo of\", \"photograph of\", \"illustration of\", \"painting of\", \"sketch of\", \"3D render of\"), honor it. Do not pivot to a different medium to avoid difficulty \u2014 match the user's stated intent.\n\nUser's Input:\n`
    },
    genOutput: null,
    genOutputs: [],
    genViewedIndex: 0,
    genProcessing: false,
    lastGenSaved: false,
    genStatusText: 'Idle',
    genProcessTime: 0,
    genResolutions: [],
    genSamplers: [],
    genSchedulers: [],
    enhancerPromptsList: {},
    newEnhancerName: '',
    enhancerToUpdate: '',

    RES_CHOICES: {
      1024: [
        { label: '1024x1024 ( 1:1 )', w: 1024, h: 1024, section: null },
        { label: '1152x896 ( 9:7 )', w: 1152, h: 896, section: 'landscape' },
        { label: '896x1152 ( 7:9 )', w: 896, h: 1152, section: 'portrait' },
        { label: '1152x864 ( 4:3 )', w: 1152, h: 864, section: 'landscape' },
        { label: '864x1152 ( 3:4 )', w: 864, h: 1152, section: 'portrait' },
        { label: '1248x832 ( 3:2 )', w: 1248, h: 832, section: 'landscape' },
        { label: '832x1248 ( 2:3 )', w: 832, h: 1248, section: 'portrait' },
        { label: '1280x720 ( 16:9 )', w: 1280, h: 720, section: 'landscape' },
        { label: '720x1280 ( 9:16 )', w: 720, h: 1280, section: 'portrait' },
        { label: '1344x576 ( 21:9 )', w: 1344, h: 576, section: 'landscape' },
        { label: '576x1344 ( 9:21 )', w: 576, h: 1344, section: 'portrait' },
      ],
      1280: [
        { label: '1280x1280 ( 1:1 )', w: 1280, h: 1280, section: null },
        { label: '1440x1120 ( 9:7 )', w: 1440, h: 1120, section: 'landscape' },
        { label: '1120x1440 ( 7:9 )', w: 1120, h: 1440, section: 'portrait' },
        { label: '1472x1104 ( 4:3 )', w: 1472, h: 1104, section: 'landscape' },
        { label: '1104x1472 ( 3:4 )', w: 1104, h: 1472, section: 'portrait' },
        { label: '1536x1024 ( 3:2 )', w: 1536, h: 1024, section: 'landscape' },
        { label: '1024x1536 ( 2:3 )', w: 1024, h: 1536, section: 'portrait' },
        { label: '1536x864 ( 16:9 )', w: 1536, h: 864, section: 'landscape' },
        { label: '864x1536 ( 9:16 )', w: 864, h: 1536, section: 'portrait' },
        { label: '1680x720 ( 21:9 )', w: 1680, h: 720, section: 'landscape' },
        { label: '720x1680 ( 9:21 )', w: 720, h: 1680, section: 'portrait' },
      ],
      1536: [
        { label: '1536x1536 ( 1:1 )', w: 1536, h: 1536, section: null },
        { label: '1728x1344 ( 9:7 )', w: 1728, h: 1344, section: 'landscape' },
        { label: '1344x1728 ( 7:9 )', w: 1344, h: 1728, section: 'portrait' },
        { label: '1728x1296 ( 4:3 )', w: 1728, h: 1296, section: 'landscape' },
        { label: '1296x1728 ( 3:4 )', w: 1296, h: 1728, section: 'portrait' },
        { label: '1872x1248 ( 3:2 )', w: 1872, h: 1248, section: 'landscape' },
        { label: '1248x1872 ( 2:3 )', w: 1248, h: 1872, section: 'portrait' },
        { label: '2048x1152 ( 16:9 )', w: 2048, h: 1152, section: 'landscape' },
        { label: '1152x2048 ( 9:16 )', w: 1152, h: 2048, section: 'portrait' },
        { label: '2016x864 ( 21:9 )', w: 2016, h: 864, section: 'landscape' },
        { label: '864x2016 ( 9:21 )', w: 864, h: 2016, section: 'portrait' },
      ],
    },
    
    // Core parameters mapping
    params: {
      mode: 'full',
      model_pack: '',
      unet_name: 'Flux2-Klein-9B-True-v2-fp8mixed.safetensors',
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
      lora1_name: 'senzu/klein9B_adonis_refine.safetensors',
      lora1_strength: 1.0,
      lora2_enabled: true,
      lora2_name: 'senzu/Flux2-Klein-9B-consistency-V2.safetensors',
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
      max_input_resolution: 768,
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
        this.updateResolutions();
        this.loadComfySamplers();
        this.loadEnhancerPrompts();
        
        setInterval(() => this.checkStatus(), 5000);
        setInterval(() => this.checkSysStats(), 5000);
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

        // Register wheel zoom on all viewer containers
        document.querySelectorAll('.compare-container').forEach(container => {
          container.addEventListener('wheel', (e) => {
            e.preventDefault();
            this.handleZoom(e);
          }, { passive: false });
        });
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

    async checkSysStats() {
      try {
        this.sysStats = await api.getSystemStats();
      } catch (err) {
        this.sysStats.available = false;
      }
    },
    
    async loadPresets() {
      try {
        this.presetsList = await api.getPresets();
        if (!this.params.prompt) {
          const firstPreset = Object.keys(this.presetsList)[0];
          if (firstPreset) this.applyPreset(firstPreset);
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
        this.updateModelNag();
      } catch (err) {
        console.error('Failed to scan models:', err);
      }
    },
    
    async loadComfySamplers() {
      try {
        const data = await api.getComfySamplers();
        this.genSamplers = data.samplers || [];
        this.genSchedulers = data.schedulers || [];
      } catch (err) {
        console.error('Failed to load samplers:', err);
        this.genSamplers = ["euler", "euler_ancestral", "dpmpp_2m", "dpmpp_2m_sde", "dpmpp_3m_sde"];
        this.genSchedulers = ["simple", "normal", "karras", "exponential", "sgm_uniform", "beta"];
      }
    },

    async loadEnhancerPrompts() {
      try { this.enhancerPromptsList = await api.getEnhancerPrompts(); }
      catch (err) { console.error('Failed to load enhancer prompts:', err); }
    },

    applyEnhancerPrompt(name) {
      if (this.enhancerPromptsList[name]) {
        this.genParams.system_prompt = this.enhancerPromptsList[name];
      }
    },

    async saveNewEnhancerPrompt() {
      if (!this.newEnhancerName.trim()) return;
      try {
        await api.saveEnhancerPrompt(this.newEnhancerName.trim(), this.genParams.system_prompt);
        this.newEnhancerName = '';
        await this.loadEnhancerPrompts();
      } catch (err) { alert('Failed: ' + err.message); }
    },

    async deleteEnhancerPrompt(name) {
      if (!confirm('Delete enhancer prompt "' + name + '"?')) return;
      try { await api.deleteEnhancerPrompt(name); await this.loadEnhancerPrompts(); }
      catch (err) { alert('Failed: ' + err.message); }
    },

    async updateEnhancerPrompt() {
      if (!this.enhancerToUpdate) return;
      if (!confirm('Overwrite "' + this.enhancerToUpdate + '" with current?')) return;
      try {
        await api.saveEnhancerPrompt(this.enhancerToUpdate, this.genParams.system_prompt);
        this.enhancerToUpdate = '';
        await this.loadEnhancerPrompts();
      } catch (err) { alert('Failed: ' + err.message); }
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
      if (name === 'Adonis-refine') {
        alert('Cannot delete the Adonis-refine preset.');
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
        this.updateModelNag();
      } catch (err) {
        console.error('Failed to load model packs:', err);
      }
    },
    
    applyModelPack(name, save) {
      const pack = this.modelPacksList[name];
      if (!pack) return;
      this.params.model_pack = name;
      this.params.use_gguf = pack.use_gguf;
      this.params.unet_name = pack.unet_name;
      this.params.clip_name = pack.clip_name;
      this.params.vae_name = pack.vae_name;
      if (save !== false) {
        this.appSettings.default_model_pack = name;
        this.saveSettings();
      }
      this.updateModelNag();
    },
    
    packModelsInstalled(pack) {
      if (!pack) return false;
      let allInstalled = this.modelExists(pack.unet_name, 'diffusion_models') &&
             this.modelExists(pack.clip_name, 'text_encoders') &&
             this.modelExists(pack.vae_name, 'vae');
      if (pack.downloads && pack.downloads.loras && Array.isArray(pack.downloads.loras)) {
        for (const lora of pack.downloads.loras) {
          const name = lora.dest_filename || lora.filename;
          if (!this.modelExists(name, 'loras')) {
            allInstalled = false;
            break;
          }
        }
      }
      return allInstalled;
    },

    anyPackInstalled() {
      for (const name of Object.keys(this.modelPacksList)) {
        if (this.packModelsInstalled(this.modelPacksList[name])) return true;
      }
      return false;
    },

    updateModelNag() {
      this.showModelNag = this.params.model_pack && this.modelPacksList[this.params.model_pack] && !this.anyPackInstalled();
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
      if (!pack || !pack.downloads) return;
      const dl = pack.downloads[modelType];
      if (!dl) return;
      const typeMap = { unet: 'unet', clip: 'text_encoder', vae: 'vae', lora: 'lora' };
      const apiType = typeMap[modelType] || 'unet';
      try {
        await api.startDownload(dl.repo, dl.filename, apiType, dl.dest_filename);
        this.pollDownloadStatus();
      } catch (err) {
        alert('Download error: ' + err.message);
      }
    },

    async downloadPackLora(packName, loraIndex) {
      const pack = this.modelPacksList[packName];
      if (!pack || !pack.downloads || !pack.downloads.loras) return;
      const dl = pack.downloads.loras[loraIndex];
      if (!dl) return;
      try {
        await api.startDownload(dl.repo, dl.filename, 'lora', dl.dest_filename);
        this.pollDownloadStatus();
      } catch (err) {
        alert('Download error: ' + err.message);
      }
    },
    
    async downloadPack(packName) {
      const pack = this.modelPacksList[packName];
      if (!pack || !pack.downloads) return;
      if (!confirm(`Download ALL models for "${packName}"? This may take a while.`)) return;

      const allItems = [{ type: 'unet', category: 'diffusion_models', dl: pack.downloads.unet },
                       { type: 'clip', category: 'text_encoders', dl: pack.downloads.clip },
                       { type: 'vae', category: 'vae', dl: pack.downloads.vae }];
      if (pack.downloads.loras && Array.isArray(pack.downloads.loras)) {
        pack.downloads.loras.forEach((lora, i) => {
          allItems.push({ type: 'lora', category: 'loras', dl: lora });
        });
      }

      for (const item of allItems) {
        if (!item.dl) continue;
        const checkName = item.dl.dest_filename || item.dl.filename;
        if (this.modelExists(checkName, item.category)) continue;
        const apiTypeMap = { unet: 'unet', clip: 'text_encoder', vae: 'vae', lora: 'lora' };
        try {
          await api.startDownload(item.dl.repo, item.dl.filename, apiTypeMap[item.type], item.dl.dest_filename);
          this.pollDownloadStatus();
          while (this.downloadState.status === 'downloading') {
            await new Promise(r => setTimeout(r, 500));
          }
        } catch (err) {
          alert(`Download failed for ${item.dl.desc || item.dl.filename}: ${err.message}`);
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
    
    async addToQueue(files) {
      const items = [];
      const IMG_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'tiff', 'tif'];
      for (const file of files) {
        if (!file.type.startsWith('image/')) {
          const ext = file.name.split('.').pop().toLowerCase();
          if (!IMG_EXTS.includes(ext)) continue;
        }
        items.push({
          id: (crypto.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2)),
          file: file,
          preview: await this.readFileAsDataURL(file),
          name: file.name,
          status: 'pending',
          size: this.formatFileSize(file.size)
        });
      }
      if (items.length === 0) return;
      
      const wasEmpty = this.imageQueue.length === 0 && !this.inputPreview;
      this.imageQueue.push(...items);
      
      // Reset queue strip scroll to show first items
      this.$nextTick(() => {
        const strip = document.querySelector('.queue-strip');
        if (strip) strip.scrollLeft = 0;
      });
      
      // If nothing is being processed or viewed, load first item
      if (wasEmpty || (!this.inputPreview && !this.queueRunning)) {
        this.setActiveInput(this.imageQueue[0]);
      }
    },
    
    removeFromQueue(idx) {
      const item = this.imageQueue[idx];
      if (!item) return;
      if (item.status === 'processing') return;
      
      if (item.preview) this.revokePreview(item.preview);
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
      this.currentInputName = item.name;
      this.outputImage = null;
      this.editOutput = null;
      this.upscaleOutput = null;
      this.displayedImage = 'final';
      this.resetZoom();
    },
    
    clearViewer() {
      if (this.inputPreview) this.revokePreview(this.inputPreview);
      this.inputFile = null;
      this.inputPreview = null;
      this.outputImage = null;
      this.editOutput = null;
      this.upscaleOutput = null;
      this.displayedImage = 'final';
      this.zoomLevel = 1;
    },
    
    viewQueueItem(idx) {
      const item = this.imageQueue[idx];
      if (!item) return;
      this.inputFile = item.file;
      this.inputPreview = item.preview;
      this.currentInputName = item.name;
      this.outputImage = null;
      this.editOutput = null;
      this.upscaleOutput = null;
      this.displayedImage = 'final';
      this.resetZoom();
    },
    
    removeInput() {
      // Legacy hook — clears queue entirely
      for (const item of this.imageQueue) {
        if (item.preview) this.revokePreview(item.preview);
      }
      this.imageQueue = [];
      this.clearViewer();
    },
    
    // Zoom controls
    updatePanCursor() {
      const c = this.getVisibleContainer();
      const isLocked = this.zoomLevel <= 1 && this.panX === 0 && this.panY === 0;
      if (c) c.classList.toggle('pan-mode', !isLocked);
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
      const container = this.getVisibleContainer();
      if (!container) return;

      const oldZoom = this.zoomLevel;
      const newZoom = e.deltaY < 0
        ? Math.min(oldZoom * 1.1, 5)
        : Math.max(oldZoom / 1.1, 0.25);

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
      const el = this.getVisibleContainer();
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
      // Only lock panning when the image is truly fit-to-view (centered at normal zoom)
      if (e.button !== 0) return;
      if (this.zoomLevel <= 1 && this.panX === 0 && this.panY === 0) return;
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

    getVisibleContainer() {
      const containers = document.querySelectorAll('.compare-container');
      for (const c of containers) {
        const rect = c.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) return c;
      }
      return containers[0];
    },

    // Show specific output
    showOutput(type) {
      this.displayedImage = type;
      if (type === 'edit' && this.editOutput) {
        this.outputImage = this.editOutput;
      } else if (type === 'final' && this.upscaleOutput) {
        this.outputImage = this.upscaleOutput;
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
      this.currentInputName = entry.inputName;
      this.outputImage = entry.upscaleOutput || entry.editOutput;
      this.editOutput = entry.editOutput;
      this.upscaleOutput = entry.upscaleOutput;
      this.outputMode = entry.mode;
      this.displayedImage = entry.upscaleOutput ? 'final' : 'edit';
      this.sliderPos = 50;
      this.resetZoom();
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
      if (entry && entry.inputPreview) this.revokePreview(entry.inputPreview);
      this.outputQueue.splice(this.viewedIndex, 1);
      if (this.outputQueue.length === 0) {
        this.clearViewer();
        this.statusText = 'Idle';
      } else {
        this.viewedIndex = Math.min(this.viewedIndex, this.outputQueue.length - 1);
        this.loadOutputView(this.viewedIndex);
      }
    },
    
    clearOutputQueue() {
      if (!confirm(`Discard all ${this.outputQueue.length} results? Unsaved outputs will be lost.`)) return;
      for (const entry of this.outputQueue) {
        if (entry.inputPreview) this.revokePreview(entry.inputPreview);
      }
      this.outputQueue = [];
      this.viewedIndex = 0;
      this.clearViewer();
      this.statusText = 'Idle';
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
          payload.input_filename = item.name;
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
          this.revokePreview(item.preview);
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

    readFileAsDataURL(file) {
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => resolve('');
        reader.readAsDataURL(file);
      });
    },

    revokePreview(url) {
      if (url && url.startsWith('blob:')) this.revokePreview(url);
    },
    
    // Slider: fixed to container window (industry-standard approach)
    getSliderStyle() {
      return `left: ${this.sliderPos}%`;
    },

    getAfterClipStyle() {
      const container = this.getVisibleContainer();
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
      const container = this.getVisibleContainer();
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      let pos = ((clientX - rect.left) / rect.width) * 100;
      if (pos < 0) pos = 0;
      if (pos > 100) pos = 100;
      this.sliderPos = pos;
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
          if (s.default_model_pack) {
            this.appSettings.default_model_pack = s.default_model_pack;
            this.applyModelPack(s.default_model_pack, false);
          }
        }
        this.applyTheme();
      } catch (err) {
        console.error('Failed to load settings:', err);
      }
    },
    
    applyTheme() {
      const t = this.appSettings.theme;
      if (t && t !== 'Default') {
        document.documentElement.setAttribute('data-theme', t.toLowerCase());
      } else {
        document.documentElement.removeAttribute('data-theme');
      }
    },
    
    async saveSettings() {
      try {
        await api.saveSettings({
          save_folder: this.appSettings.save_folder,
          autosave: this.appSettings.autosave,
          clear_temp_on_start: this.appSettings.clear_temp_on_start,
          theme: this.appSettings.theme,
          default_model_pack: this.appSettings.default_model_pack
        });
        this.applyTheme();
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
      let destName = null;
      let suffix = '';
      
      if (type === 'edit' && this.editOutput) {
        url = this.editOutput;
        suffix = 'ed';
      } else if (type === 'final' && this.upscaleOutput) {
        url = this.upscaleOutput;
        suffix = this.editOutput ? 'ed_ups' : 'ups';
      } else if (this.outputImage) {
        url = this.outputImage;
        suffix = this.outputMode === 'full' ? 'ed_ups' : (this.outputMode === 'edit' ? 'ed' : 'ups');
      }
      if (!url) return;
      
      const tempFilename = url.split('/').pop();
      const stem = this.currentInputName.replace(/\.[^.]+$/, '') || 'senzu';
      const ts = Date.now().toString(36);
      destName = `${stem}_senzu_${suffix}_${ts}.png`;
      
      // Server-side save if folder configured, else browser download
      const saveFolder = this.appSettings.save_folder;
      if (saveFolder && saveFolder.trim()) {
        try {
          await api.saveOutputToFolder(tempFilename, saveFolder, destName);
          this.lastSavedType = type;
          setTimeout(() => { this.lastSavedType = ''; }, 2000);
          return;
        } catch (err) {
          alert('Failed to save to folder: ' + err.message);
        }
      }
      
      // Fallback: browser download
      const a = document.createElement('a');
      a.href = url;
      a.download = destName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      this.lastSavedType = type;
      setTimeout(() => { this.lastSavedType = ''; }, 2000);
    },
    
    async rerunOutput(type) {
      let url = null;
      if (type === 'original') {
        // Re-add from current input preview — need to create a File from the blob
        const blob = await fetch(this.inputPreview).then(r => r.blob());
        const file = new File([blob], this.currentInputName || 'rerun.png', { type: blob.type });
        this.addToQueue([file]);
      } else if (type === 'edit' && this.editOutput) {
        url = this.editOutput;
      } else if (type === 'final' && this.upscaleOutput) {
        url = this.upscaleOutput;
      }
      if (url) {
        const blob = await fetch(url).then(r => r.blob());
        const filename = `${this.currentInputName.replace(/\.[^.]+$/, '') || 'rerun'}_rerun.png`;
        const file = new File([blob], filename, { type: blob.type });
        this.addToQueue([file]);
      }
    },
    
    formatTime(seconds) {
      const m = Math.floor(seconds / 60);
      const s = seconds % 60;
      return `${m}:${s < 10 ? '0' : ''}${s}`;
    },

    // Krea2 Image Generation
    updateResolutions() {
      const choices = this.RES_CHOICES[this.genParams.base_size] || this.RES_CHOICES[1024];
      this.genResolutions = [
        choices[0],  // square
        { label: '── Portrait ──', w: 0, h: 0, section: 'header' },
        ...choices.filter(c => c.section === 'portrait'),
        { label: '── Landscape ──', w: 0, h: 0, section: 'header' },
        ...choices.filter(c => c.section === 'landscape'),
      ];
    },

    applyResolutionLabel(label) {
      const choices = this.RES_CHOICES[this.genParams.base_size] || this.RES_CHOICES[1024];
      for (const c of [...choices, ...this.genResolutions]) {
        if (c.label === label && c.w > 0) {
          this.genParams.width = c.w;
          this.genParams.height = c.h;
          return;
        }
      }
    },

    async startGeneration() {
      if (!this.genParams.prompt.trim()) return;
      this.genProcessing = true;
      this.genStatusText = 'Generating...';
      this.genProcessTime = 0;
      const genTimer = setInterval(() => { this.genProcessTime++; }, 1000);
      try {
        const res = await api.generateImage(this.genParams);
        this.genOutputs.push({ url: res.output, prompt: this.genParams.prompt });
        this.genViewedIndex = this.genOutputs.length - 1;
        this.genOutput = res.output;
        this.genStatusText = this.genOutputs.length + ' image' + (this.genOutputs.length !== 1 ? 's' : '') + ' generated';
        if (res.enhanced_prompt) {
          this.genParams.prompt = res.enhanced_prompt;
        }
      } catch (err) {
        this.genStatusText = 'Error: ' + err.message;
      }
      clearInterval(genTimer);
      this.genProcessing = false;
    },

    prevGenOutput() {
      if (this.genViewedIndex > 0) {
        this.genViewedIndex--;
        this.genOutput = this.genOutputs[this.genViewedIndex].url;
        this.resetZoom();
      }
    },

    nextGenOutput() {
      if (this.genViewedIndex < this.genOutputs.length - 1) {
        this.genViewedIndex++;
        this.genOutput = this.genOutputs[this.genViewedIndex].url;
        this.resetZoom();
      }
    },

    async sendToEnhancer() {
      if (!this.genOutput) return;
      try {
        const blob = await fetch(this.genOutput).then(r => r.blob());
        const file = new File([blob], 'senzu_gen_' + Date.now().toString(36) + '.png', { type: blob.type || 'image/png' });
        this.activeTab = 'enhance';
        this.addToQueue([file]);
      } catch (err) {
        alert('Failed to send to enhancer: ' + err.message);
      }
    },

    discardGenOutput() {
      if (this.genOutputs.length === 0) return;
      this.genOutputs.splice(this.genViewedIndex, 1);
      if (this.genOutputs.length === 0) {
        this.genOutput = null;
        this.genViewedIndex = 0;
        this.genStatusText = 'Idle';
        this.genProcessTime = 0;
      } else {
        this.genViewedIndex = Math.min(this.genViewedIndex, this.genOutputs.length - 1);
        this.genOutput = this.genOutputs[this.genViewedIndex].url;
      }
    },

    clearGenOutputs() {
      if (!confirm('Discard all ' + this.genOutputs.length + ' generated results?')) return;
      this.genOutputs = [];
      this.genOutput = null;
      this.genViewedIndex = 0;
      this.genStatusText = 'Idle';
      this.genProcessTime = 0;
    },

    async downloadGenOutput() {
      if (!this.genOutput) return;
      const tempFilename = this.genOutput.split('/').pop();
      const ts = Date.now().toString(36);
      const destName = `senzu_gen_${ts}.png`;

      const saveFolder = this.appSettings.save_folder;
      if (saveFolder && saveFolder.trim()) {
        const genFolder = saveFolder.replace(/[\\/]$/, '') + '/gen';
        try {
          await api.saveOutputToFolder(tempFilename, genFolder, destName);
          this.lastGenSaved = true;
          setTimeout(() => { this.lastGenSaved = false; }, 2000);
          return;
        } catch (err) {
          alert('Failed to save: ' + err.message);
        }
      }

      const a = document.createElement('a');
      a.href = this.genOutput;
      a.download = destName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      this.lastGenSaved = true;
      setTimeout(() => { this.lastGenSaved = false; }, 2000);
    },

    openGenOutputs() {
      const folder = this.appSettings.save_folder || '';
      api.openOutputs(folder);
    }
  }));
});
