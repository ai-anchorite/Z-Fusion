const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '../data');
const MODEL_PACKS_FILE = path.join(DATA_DIR, 'senzu-model-packs.json');

const DEFAULT_PACKS = {
  "FP8 Standard": {
    use_gguf: false,
    unet_name: "flux-2-klein-9b-kv-fp8.safetensors",
    clip_name: "qwen_3_8b_fp8mixed.safetensors",
    vae_name: "flux2-vae.safetensors",
    is_recommended: true,
    downloads: {
      unet: { repo: "Lytanshade/Flux2-Klein-9B", filename: "flux-2-klein-9b-kv-fp8.safetensors", desc: "Flux2 Klein 9B UNet (fp8)", size: "9.8GB" },
      clip: { repo: "Lytanshade/Flux2-Klein-9B", filename: "qwen_3_8b_fp8mixed.safetensors", desc: "Qwen3 8B CLIP (fp8)", size: "8.6GB" },
      vae: { repo: "black-forest-labs/FLUX.1-schnell", filename: "flux2-vae.safetensors", desc: "Flux2 VAE", size: "336MB" }
    }
  },
  "Q4 Low VRAM": {
    use_gguf: true,
    unet_name: "flux-2-klein-9b-Q4_K_M.gguf",
    clip_name: "Qwen3-4B-Q8_0.gguf",
    vae_name: "flux2-vae.safetensors",
    is_recommended: true,
    downloads: {
      unet: { repo: "city96/Flux-2-Klein-GGUF", filename: "flux-2-klein-9b-Q4_K_M.gguf", desc: "Flux2 Klein 9B UNet (Q4 GGUF)", size: "5.9GB" },
      clip: { repo: "city96/Flux-2-Klein-GGUF", filename: "Qwen3-4B-Q8_0.gguf", desc: "Qwen3 4B CLIP (Q8 GGUF)", size: "4.2GB" },
      vae: { repo: "black-forest-labs/FLUX.1-schnell", filename: "flux2-vae.safetensors", desc: "Flux2 VAE", size: "336MB" }
    }
  }
};

function ensurePacksExist() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(MODEL_PACKS_FILE)) {
    fs.writeFileSync(MODEL_PACKS_FILE, JSON.stringify(DEFAULT_PACKS, null, 2), 'utf-8');
  }
}

function loadModelPacks() {
  ensurePacksExist();
  try {
    const data = fs.readFileSync(MODEL_PACKS_FILE, 'utf-8');
    return JSON.parse(data);
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
