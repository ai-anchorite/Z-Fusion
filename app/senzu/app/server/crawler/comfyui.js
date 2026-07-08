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

      // Iterate through all nodes
      for (const nodeId in workflow) {
        const node = workflow[nodeId];
        if (!node || !node.class_type) continue;

        const inputs = node.inputs || {};
        const classType = node.class_type;

        // Extract prompts from text encode nodes
        if (classType === 'CLIPTextEncode') {
          const text = this.extractText(inputs.text, workflow);
          const title = node._meta?.title?.toLowerCase() || '';
          
          if (title.includes('negative') || title.includes('neg')) {
            result.negative_prompt = text;
          } else if (title.includes('positive') || title.includes('pos') || !result.prompt) {
            result.prompt = text;
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
          if (inputs.seed !== undefined) result.seed = inputs.seed;
          if (inputs.noise_seed !== undefined) result.seed = inputs.noise_seed;
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
        }

        // Extract upscale dimensions
        if (classType === 'LatentUpscale' && !result.width) {
          if (inputs.width) result.width = inputs.width;
          if (inputs.height) result.height = inputs.height;
        }

        // Extract model names
        if (classType === 'UNETLoader' || classType === 'CheckpointLoaderSimple' || classType.includes('ModelLoader')) {
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
        if (classType === 'LoraLoader' || classType.includes('Lora') || classType.includes('LoRA')) {
          const loraName = inputs.lora_name;
          const strength = inputs.strength_model || inputs.strength || 1.0;
          
          // Only add if lora_name exists and isn't "none"
          if (loraName && loraName.toLowerCase() !== 'none' && loraName.toLowerCase() !== 'none.safetensors') {
            result.loras.push({
              name: this.cleanModelName(loraName),
              strength: strength
            });
          }
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
   * Extract text from input, handling both direct strings and node references
   */
  extractText(textInput, workflow) {
    if (typeof textInput === 'string') {
      return textInput;
    }
    
    // Handle node reference format ["nodeId", outputIndex]
    if (Array.isArray(textInput) && textInput.length >= 1) {
      const refNodeId = textInput[0];
      const refNode = workflow[refNodeId];
      if (refNode && refNode.inputs) {
        // Follow the referenced node's text-carrying input. CLIPTextEncode uses
        // `text`, primitive string nodes (PrimitiveStringMultiline / String
        // literals) use `value` or `string`.
        const inputs = refNode.inputs;
        const candidate = inputs.text != null ? inputs.text
          : inputs.value != null ? inputs.value
          : inputs.string != null ? inputs.string
          : null;
        if (candidate != null) {
          return this.extractText(candidate, workflow);
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
