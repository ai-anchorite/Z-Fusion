class ComfyUIParser {
  /**
   * Parse ComfyUI workflow JSON to extract generation parameters
   */
  parse(workflowJson) {
    try {
      const workflow = typeof workflowJson === 'string' ? JSON.parse(workflowJson) : workflowJson;
      
      const result = {
        prompt: null,
        negative_prompt: null,
        steps: null,
        cfg_scale: null,
        sampler: null,
        scheduler: null,
        seed: null,
        width: null,
        height: null,
        model_name: null,
        vae_name: null,
        clip_name: null,
        denoise: null,
        shift: null,
        loras: []
      };

      // When a "Senzu Parent Metadata" node is present, the image has passed
      // through the Enhance pipeline — the *creative* fields (prompt, seed,
      // model, loras) belong to the original generation stage. The current
      // workflow's own prompt/loras (the edit stage) are captured separately
      // and must not overwrite the inherited creative record.
      // Pre-scan: the payload node may appear anywhere in the graph, but
      // CLIPTextEncode/LoRA nodes usually come earlier in key order. Set the
      // flag before the main loop so the stash phase doesn't miss them.
      let hasParentMeta = false;
      for (const nodeId in workflow) {
        const n = workflow[nodeId];
        if (n?._meta?.title === 'Senzu Parent Metadata' && n.inputs?.value) {
          hasParentMeta = true;
          break;
        }
      }
      let editPrompt = null;
      const editLoras = [];
      let inheritedProcessParams = null;

      // Iterate through all nodes
      for (const nodeId in workflow) {
        const node = workflow[nodeId];
        if (!node || !node.class_type) continue;

        const inputs = node.inputs || {};
        const classType = node.class_type;
        const metaTitle = node._meta?.title || '';

        // Senzu Parent Metadata node — carries the creative fields from the
        // previous pipeline stage. These represent the *original* generation
        // and should fill the top-level record (prompt, seed, model, loras).
        if (metaTitle === 'Senzu Parent Metadata' && inputs.value) {
          try {
            const parent = JSON.parse(inputs.value);
            if (parent.prompt) result.prompt = parent.prompt;
            if (parent.seed != null) result.seed = parent.seed;
            if (parent.model_name) result.model_name = parent.model_name;
            if (parent.negative_prompt) result.negative_prompt = parent.negative_prompt;
            if (parent.loras && Array.isArray(parent.loras)) {
              result.loras = parent.loras.map(l => ({
                name: l.name || this.cleanModelName(l.name) || '',
                strength: l.strength
              }));
            }
            // Carry forward any previously-accumulated process_params
            // from earlier pipeline stages (edit → upscale chaining).
            if (parent._process_params) {
              inheritedProcessParams = parent._process_params;
            }
          } catch (_) {}
          continue;
        }

        // Extract prompts from text encode nodes
        if (classType === 'CLIPTextEncode') {
          const text = this.extractText(inputs.text, workflow);
          const title = node._meta?.title?.toLowerCase() || '';
          
          if (title.includes('negative') || title.includes('neg')) {
            if (!hasParentMeta || !result.negative_prompt) result.negative_prompt = text;
          } else if (text) {
            // Non-negative prompt node with actual content.
            // With parent metadata this is the edit stage's prompt;
            // without it this *is* the creative prompt.
            if (hasParentMeta) {
              if (!editPrompt) editPrompt = text;
            } else {
              result.prompt = text;
            }
          }
        }

        // Krea2EditGroundedEncode — prompt + grounding for identity-editing workflows
        if (classType === 'Krea2EditGroundedEncode') {
          const text = this.extractText(inputs.prompt, workflow);
          const title = node._meta?.title?.toLowerCase() || '';

          if (title.includes('negative') || title.includes('neg')) {
            if (!hasParentMeta || !result.negative_prompt) result.negative_prompt = text;
          } else {
            if (!hasParentMeta) result.prompt = text;
          }
        }

        // Extract from text box nodes
        if (classType === 'VRGDG_TextBox' || classType.includes('TextBox') || classType.includes('Text')) {
          const text = this.extractText(inputs.text, workflow);
          if (text && !result.prompt) {
            result.prompt = text;
          }
        }

        // Extract sampler parameters
        if (classType === 'KSampler' || classType === 'SamplerCustom' || classType.includes('Sampler')) {
          if (inputs.steps) result.steps = inputs.steps;
          if (inputs.cfg) result.cfg_scale = inputs.cfg;
          if (inputs.sampler_name) result.sampler = inputs.sampler_name;
          if (inputs.scheduler) result.scheduler = inputs.scheduler;
          // Seed may be a direct int or a node reference (e.g. Seed (rgthree)).
          // Resolve references so we store the actual seed number.
          if (inputs.seed !== undefined) {
            result.seed = this.resolveIntRef(inputs.seed, workflow);
          }
          if (inputs.noise_seed !== undefined) {
            result.seed = this.resolveIntRef(inputs.noise_seed, workflow);
          }
          if (inputs.denoise !== undefined) result.denoise = inputs.denoise;
          if (inputs.shift !== undefined) result.shift = inputs.shift;
        }

        // Extract scheduler parameters
        if (classType.includes('Scheduler')) {
          if (inputs.steps) result.steps = inputs.steps;
          if (inputs.shift !== undefined) result.shift = inputs.shift;
        }

        // Extract sampler selection
        if (classType === 'KSamplerSelect') {
          if (inputs.sampler_name) result.sampler = inputs.sampler_name;
        }

        // Extract dimensions from latent nodes
        if (classType.includes('LatentImage') || classType.includes('EmptyLatent')) {
          if (inputs.width) result.width = inputs.width;
          if (inputs.height) result.height = inputs.height;
          // SDXL Empty Latent Image (rgthree) uses a `dimensions` text field
          if (inputs.dimensions && typeof inputs.dimensions === 'string') {
            const m = inputs.dimensions.match(/(\d+)\s*x\s*(\d+)/);
            if (m) { result.width = parseInt(m[1], 10); result.height = parseInt(m[2], 10); }
          }
        }

        // Extract upscale dimensions
        if (classType === 'LatentUpscale' && !result.width) {
          if (inputs.width) result.width = inputs.width;
          if (inputs.height) result.height = inputs.height;
        }

        // Extract model names
        if (classType === 'UNETLoader' || classType === 'CheckpointLoaderSimple' || classType === 'OTUNetLoaderW8A8' || classType.includes('ModelLoader')) {
          if (inputs.unet_name) {
            result.model_name = this.cleanModelName(inputs.unet_name);
          } else if (inputs.ckpt_name) {
            result.model_name = this.cleanModelName(inputs.ckpt_name);
          }
        }

        // Extract VAE
        if (classType === 'VAELoader') {
          if (inputs.vae_name) {
            result.vae_name = this.cleanModelName(inputs.vae_name);
          }
        }

        // Extract CLIP
        if (classType === 'CLIPLoader') {
          if (inputs.clip_name) {
            result.clip_name = this.cleanModelName(inputs.clip_name);
          }
        }

        // Extract LoRA information
        const loraClasses = ['LoraLoader', 'LoraLoaderModelOnly', 'LoraLoaderAdvanced'];
        const isStandardLora = loraClasses.includes(classType) || (classType.endsWith('Lora') && !classType.includes('Florence'));
        const isPowerLora = classType.includes('Power Lora Loader') || classType.includes('PowerLoraLoader');
        if (isStandardLora || isPowerLora) {
          if (isPowerLora) {
            // Power Lora Loader (rgthree): lora data is in nested sub-objects
            // like lora_1: {on: true, lora: "path/file.safetensors", strength: 0.6}
            for (const key of Object.keys(inputs)) {
              if (!key.startsWith('lora_') || key.includes('Header')) continue;
              const entry = inputs[key];
              if (entry && typeof entry === 'object' && entry.on && entry.lora) {
                const name = entry.lora;
                const strength = entry.strength != null ? entry.strength : 1.0;
                if (name && name.toLowerCase() !== 'none' && name.toLowerCase() !== 'none.safetensors') {
                  const target = hasParentMeta ? editLoras : result.loras;
                  target.push({ name: this.cleanModelName(name), strength });
                }
              }
            }
          } else {
            const loraName = inputs.lora_name;
            const strength = inputs.strength_model || inputs.strength || 1.0;
            
            // Only add if lora_name exists and isn't "none"
            if (loraName && loraName.toLowerCase() !== 'none' && loraName.toLowerCase() !== 'none.safetensors') {
              const target = hasParentMeta ? editLoras : result.loras;
              target.push({
                name: this.cleanModelName(loraName),
                strength: strength
              });
            }
          }
        }
      }

      // Build process_params from the collected edit/upscale stage data.
      // Only populated when parent metadata is present (enhanced images).
      if (hasParentMeta) {
        const pp = {};
        if (editPrompt || editLoras.length > 0) {
          pp.edit = {};
          if (editPrompt) pp.edit.prompt = editPrompt;
          if (editLoras.length > 0) pp.edit.loras = editLoras;
        }
        // Carry forward any process_params from earlier pipeline stages.
        if (inheritedProcessParams) {
          try {
            const prev = JSON.parse(inheritedProcessParams);
            if (prev.edit && !pp.edit) pp.edit = prev.edit;
            if (prev.upscale && !pp.upscale) pp.upscale = prev.upscale;
          } catch (_) {}
        }
        // Capture upscale-stage info when the upscaler node is present.
        for (const nodeId in workflow) {
          const node = workflow[nodeId];
          if (node?.class_type === 'SeedVR2VideoUpscaler') {
            pp.upscale = {};
            if (node.inputs.resolution) pp.upscale.resolution = node.inputs.resolution;
            break;
          }
        }
        // Capture SeedVR2 model from the DiT loader.
        for (const nodeId in workflow) {
          const node = workflow[nodeId];
          if (node?.class_type === 'SeedVR2LoadDiTModel') {
            if (!pp.upscale) pp.upscale = {};
            if (node.inputs.model) pp.upscale.model = node.inputs.model;
            break;
          }
        }
        if (Object.keys(pp).length > 0) {
          result.process_params = JSON.stringify(pp);
        }
      }

      // Clean up null values and empty arrays
      const cleaned = {};
      for (const key in result) {
        if (result[key] !== null && result[key] !== undefined) {
          // Skip empty loras array
          if (key === 'loras' && result[key].length === 0) continue;
          cleaned[key] = result[key];
        }
      }

      return cleaned;
    } catch (e) {
      console.error('ComfyUI parse error:', e);
      return null;
    }
  }

  /**
   * Resolve an int value that may be a direct number or a node reference
   * (e.g. ["276", 0] pointing to a Seed (rgthree) node).
   */
  resolveIntRef(value, workflow, depth = 0) {
    if (depth > 5) return value;
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
      const n = parseInt(value, 10);
      return Number.isFinite(n) ? n : value;
    }
    if (Array.isArray(value) && value.length >= 1 && typeof value[0] === 'string') {
      const refNode = workflow[value[0]];
      if (refNode?.inputs?.seed != null) {
        return this.resolveIntRef(refNode.inputs.seed, workflow, depth + 1);
      }
    }
    return value;
  }

  /**
   * Extract text from input, handling both direct strings and node references.
   * Follows chains up to 5 hops deep (e.g. PrimitiveStringMultiline → Text Concatenate → CLIPTextEncode).
   */
  extractText(textInput, workflow, depth = 0) {
    if (depth > 5) return null;
    if (typeof textInput === 'string') {
      return textInput;
    }
    
    // Handle node reference format ["nodeId", outputIndex]
    if (Array.isArray(textInput) && textInput.length >= 1) {
      const refNodeId = textInput[0];
      const refNode = workflow[refNodeId];
      if (refNode && refNode.inputs) {
        const inputs = refNode.inputs;
        // StringConcatenate / TextConcatenate: join string_a + string_b
        if (refNode.class_type === 'StringConcatenate' || refNode.class_type === 'TextConcatenate') {
          const a = inputs.string_a != null
            ? this.extractText(inputs.string_a, workflow, depth + 1)
            : '';
          const b = inputs.string_b != null
            ? this.extractText(inputs.string_b, workflow, depth + 1)
            : '';
          if (a || b) return (a || '') + (b || '');
          return null;
        }
        const candidate = inputs.text != null ? inputs.text
          : inputs.value != null ? inputs.value
          : inputs.string != null ? inputs.string
          : inputs.wildcard_text != null ? inputs.wildcard_text
          : inputs.populated_text != null ? inputs.populated_text
          : null;
        if (candidate != null) {
          return this.extractText(candidate, workflow, depth + 1);
        }
      }
    }
    
    return null;
  }

  /**
   * Clean model name by removing path and extension
   */
  cleanModelName(name) {
    if (!name) return null;
    // Remove path separators
    const parts = name.split(/[/\\]/);
    const filename = parts[parts.length - 1];
    // Remove extension
    return filename.replace(/\.(safetensors|ckpt|pt|pth)$/i, '');
  }
}

module.exports = ComfyUIParser;
