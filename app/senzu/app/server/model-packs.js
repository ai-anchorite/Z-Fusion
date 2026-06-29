const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '../data');
const MODEL_PACKS_FILE = path.join(DATA_DIR, 'senzu-model-packs.json');
const PACKS_VERSION = 5;

const DEFAULT_PACKS = {
  "FP8 Standard": {
    use_gguf: false,
    unet_name: "Flux2-Klein-9B-True-v2-fp8mixed.safetensors",
    clip_name: "qwen_3_8b_fp8mixed.safetensors",
    vae_name: "flux2-vae.safetensors",
    is_recommended: true,
    category: "edit",
    description: "Good balance of size, speed, and quality. Recommended for NVIDIA GPUs.",
    downloads: {
      unet: { repo: "wikeeyang/Flux2-Klein-9B-True-V2", filename: "Flux2-Klein-9B-True-v2-fp8mixed.safetensors", desc: "Flux2 Klein 9B True v2 (FP8 finetune)", size: "~10GB" },
      clip: { repo: "Comfy-Org/vae-text-encorder-for-flux-klein-9b", filename: "split_files/text_encoders/qwen_3_8b_fp8mixed.safetensors", dest_filename: "qwen_3_8b_fp8mixed.safetensors", desc: "Qwen3 8B CLIP (FP8)", size: "~8.6GB" },
      vae: { repo: "Comfy-Org/vae-text-encorder-for-flux-klein-9b", filename: "split_files/vae/flux2-vae.safetensors", dest_filename: "flux2-vae.safetensors", desc: "Flux2 VAE", size: "~336MB" },
      loras: [
        { repo: "n8te0/adonis_flux2klein", filename: "adonis_refine.safetensors", dest_filename: "senzu/klein9B_adonis_refine.safetensors", desc: "Adonis Refine LoRA", size: "~1.5GB" },
        { repo: "dx8152/Flux2-Klein-9B-Consistency", filename: "Flux2-Klein-9B-consistency-V2.safetensors", dest_filename: "senzu/Flux2-Klein-9B-consistency-V2.safetensors", desc: "Consistency V2 LoRA", size: "~1.5GB" }
      ]
    }
  },
  "Q8 High Quality": {
    use_gguf: true,
    unet_name: "flux-2-klein-9b-Q8_0.gguf",
    clip_name: "Qwen3-8B-Q8_0.gguf",
    vae_name: "flux2-vae.safetensors",
    is_recommended: true,
    category: "edit",
    description: "High quality GGUF. Good for macOS, AMD GPUs, and lower VRAM systems.",
    downloads: {
      unet: { repo: "unsloth/FLUX.2-klein-9B-GGUF", filename: "flux-2-klein-9b-Q8_0.gguf", desc: "Flux2 Klein 9B UNet (Q8 GGUF)", size: "~12GB" },
      clip: { repo: "unsloth/Qwen3-8B-GGUF", filename: "Qwen3-8B-Q8_0.gguf", desc: "Qwen3 8B CLIP (Q8 GGUF)", size: "~8.6GB" },
      vae: { repo: "Comfy-Org/vae-text-encorder-for-flux-klein-9b", filename: "split_files/vae/flux2-vae.safetensors", dest_filename: "flux2-vae.safetensors", desc: "Flux2 VAE", size: "~336MB" },
      loras: [
        { repo: "n8te0/adonis_flux2klein", filename: "adonis_refine.safetensors", dest_filename: "senzu/klein9B_adonis_refine.safetensors", desc: "Adonis Refine LoRA", size: "~1.5GB" },
        { repo: "dx8152/Flux2-Klein-9B-Consistency", filename: "Flux2-Klein-9B-consistency-V2.safetensors", dest_filename: "senzu/Flux2-Klein-9B-consistency-V2.safetensors", desc: "Consistency V2 LoRA", size: "~1.5GB" }
      ]
    }
  },
  "Q4 Low VRAM": {
    use_gguf: true,
    unet_name: "flux-2-klein-9b-Q4_K_M.gguf",
    clip_name: "Qwen3-8B-Q4_K_M.gguf",
    vae_name: "flux2-vae.safetensors",
    is_recommended: true,
    category: "edit",
    description: "Compact quantized models for lower VRAM systems.",
    downloads: {
      unet: { repo: "unsloth/FLUX.2-klein-9B-GGUF", filename: "flux-2-klein-9b-Q4_K_M.gguf", desc: "Flux2 Klein 9B UNet (Q4_K_M GGUF)", size: "~6.2GB" },
      clip: { repo: "unsloth/Qwen3-8B-GGUF", filename: "Qwen3-8B-Q4_K_M.gguf", desc: "Qwen3 8B CLIP (Q4_K_M GGUF)", size: "~4.5GB" },
      vae: { repo: "Comfy-Org/vae-text-encorder-for-flux-klein-9b", filename: "split_files/vae/flux2-vae.safetensors", dest_filename: "flux2-vae.safetensors", desc: "Flux2 VAE", size: "~336MB" },
      loras: [
        { repo: "n8te0/adonis_flux2klein", filename: "adonis_refine.safetensors", dest_filename: "senzu/klein9B_adonis_refine.safetensors", desc: "Adonis Refine LoRA", size: "~1.5GB" },
        { repo: "dx8152/Flux2-Klein-9B-Consistency", filename: "Flux2-Klein-9B-consistency-V2.safetensors", dest_filename: "senzu/Flux2-Klein-9B-consistency-V2.safetensors", desc: "Consistency V2 LoRA", size: "~1.5GB" }
      ]
    }
  },
  "Krea2 Standard": {
    use_gguf: false,
    unet_name: "krea2_turbo_fp8_scaled.safetensors",
    clip_name: "qwen3vl_4b_fp8_scaled.safetensors",
    vae_name: "qwen_image_vae.safetensors",
    is_recommended: true,
    category: "generate",
    description: "Krea2 Turbo T2I model. Fast 8-step generation.",
    downloads: {
      unet: { repo: "Comfy-Org/Krea-2", filename: "diffusion_models/krea2_turbo_fp8_scaled.safetensors", dest_filename: "krea2_turbo_fp8_scaled.safetensors", desc: "Krea2 Turbo Diffusion (FP8)", size: "~13GB" },
      clip: { repo: "Comfy-Org/Krea-2", filename: "text_encoders/qwen3vl_4b_fp8_scaled.safetensors", dest_filename: "qwen3vl_4b_fp8_scaled.safetensors", desc: "Qwen3-VL 4B TE (FP8)", size: "~5GB" },
      vae: { repo: "Comfy-Org/Krea-2", filename: "vae/qwen_image_vae.safetensors", dest_filename: "qwen_image_vae.safetensors", desc: "Krea2 VAE", size: "~0.25GB" }
    }
  },
  "Z-Image Standard": {
    use_gguf: false,
    unet_name: "z_image_turbo_bf16.safetensors",
    clip_name: "qwen_3_4b.safetensors",
    vae_name: "ae.safetensors",
    is_recommended: true,
    category: "generate",
    description: "Z-Image Turbo model. Fast 4-step generation with excellent prompt adherence.",
    downloads: {
      unet: { repo: "Comfy-Org/z_image_turbo", filename: "split_files/diffusion_models/z_image_turbo_bf16.safetensors", dest_filename: "z_image_turbo_bf16.safetensors", desc: "Z-Image Diffusion (BF16)", size: "~12GB" },
      clip: { repo: "Comfy-Org/z_image_turbo", filename: "split_files/text_encoders/qwen_3_4b.safetensors", dest_filename: "qwen_3_4b.safetensors", desc: "Qwen3 4B TE (BF16)", size: "~8GB" },
      vae: { repo: "Comfy-Org/z_image_turbo", filename: "split_files/vae/ae.safetensors", dest_filename: "ae.safetensors", desc: "Z-Image VAE", size: "~0.3GB" }
    }
  },
  "Klein Standard (Generate)": {
    use_gguf: false,
    unet_name: "Flux2-Klein-9B-True-v2-fp8mixed.safetensors",
    clip_name: "qwen_3_8b_fp8mixed.safetensors",
    vae_name: "flux2-vae.safetensors",
    is_recommended: true,
    category: "generate",
    description: "Flux2 Klein 9B for image generation. Same model as the Enhancer pack, sans LoRAs.",
    downloads: {
      unet: { repo: "wikeeyang/Flux2-Klein-9B-True-V2", filename: "Flux2-Klein-9B-True-v2-fp8mixed.safetensors", desc: "Flux2 Klein 9B True v2 (FP8)", size: "~10GB" },
      clip: { repo: "Comfy-Org/vae-text-encorder-for-flux-klein-9b", filename: "split_files/text_encoders/qwen_3_8b_fp8mixed.safetensors", dest_filename: "qwen_3_8b_fp8mixed.safetensors", desc: "Qwen3 8B CLIP (FP8)", size: "~8.6GB" },
      vae: { repo: "Comfy-Org/vae-text-encorder-for-flux-klein-9b", filename: "split_files/vae/flux2-vae.safetensors", dest_filename: "flux2-vae.safetensors", desc: "Flux2 VAE", size: "~336MB" }
    }
  }
};

function ensurePacksExist() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  let needsRegen = false;
  if (!fs.existsSync(MODEL_PACKS_FILE)) {
    needsRegen = true;
  } else {
    try {
      const existing = JSON.parse(fs.readFileSync(MODEL_PACKS_FILE, 'utf-8'));
      if (!existing._version || existing._version < PACKS_VERSION) {
        needsRegen = true;
      }
    } catch (e) {
      needsRegen = true;
    }
  }
  if (needsRegen) {
    const defaults = { _version: PACKS_VERSION };
    Object.assign(defaults, DEFAULT_PACKS);
    fs.writeFileSync(MODEL_PACKS_FILE, JSON.stringify(defaults, null, 2), 'utf-8');
  }
}

function loadModelPacks() {
  ensurePacksExist();
  try {
    const data = JSON.parse(fs.readFileSync(MODEL_PACKS_FILE, 'utf-8'));
    return data;
  } catch (err) {
    console.error("Error reading model packs:", err);
    return DEFAULT_PACKS;
  }
}

function saveModelPack(name, data) {
  ensurePacksExist();
  const packs = loadModelPacks();

  if (packs[name] && packs[name].is_recommended) {
    return { success: false, error: "Cannot overwrite a recommended model pack." };
  }

  packs[name] = data;
  packs._version = PACKS_VERSION;
  try {
    fs.writeFileSync(MODEL_PACKS_FILE, JSON.stringify(packs, null, 2), 'utf-8');
    return { success: true };
  } catch (err) {
    console.error("Error saving model pack:", err);
    return { success: false, error: err.message };
  }
}

function deleteModelPack(name) {
  ensurePacksExist();
  const packs = loadModelPacks();
  if (packs[name]) {
    if (packs[name].is_recommended) {
      return { success: false, error: "Cannot delete a recommended model pack." };
    }
    delete packs[name];
    packs._version = PACKS_VERSION;
    try {
      fs.writeFileSync(MODEL_PACKS_FILE, JSON.stringify(packs, null, 2), 'utf-8');
      return { success: true };
    } catch (err) {
      console.error("Error deleting model pack:", err);
      return { success: false, error: err.message };
    }
  }
  return { success: false, error: "Model pack not found" };
}

module.exports = {
  loadModelPacks,
  saveModelPack,
  deleteModelPack,
  DEFAULT_PACKS
};
