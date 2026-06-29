const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '../data');
const PRESETS_FILE = path.join(DATA_DIR, 'senzu-presets.json');

const DEFAULT_PRESET = {
  "Adonis-refine": {
    mode: "full",
    model_pack: "FP8 Standard",
    unet_name: "Flux2-Klein-9B-True-v2-fp8mixed.safetensors",
    clip_name: "qwen_3_8b_fp8mixed.safetensors",
    vae_name: "flux2-vae.safetensors",
    use_gguf: false,
    steps: 4,
    cfg: 1.0,
    megapixels: 1.0,
    sampler_name: "euler",
    randomize_seed: true,
    negative_prompt: "",
    prompt: "uhdmanscale, fully reconstruct this entire image from cellphone quality to professional high resolution color raw quality. Remove halftone dot pattern. Apply descreen filter. Eliminate periodic grid noise. Eliminate repeating noise patterns and artifacts, remove uniform diagonal line texture patterns. Reconstruct low resolution high ISO noise areas with high resolution low ISO noise textures.\n\nApply full detail reconstruction to all areas: background, environment, surfaces, objects, clothing, and foreground elements — render everything sharp, textured, and high fidelity.\n\nSubject identity is locked: preserve exact facial geometry and body geometry, eye shape and color, nose and mouth shape, and expression. On skin areas, remove color blotch artifacts, normalize tone uniformity, preserve natural pore and texture detail. On hair and body hair areas, separate smeared color artifacts, restore strand separation and texture. Outside the subject's face, freely reconstruct all texture and sharpness with no restrictions.\n\nDeblur and focus correction pass. Infer and reconstruct underlying detail from soft source: sharpen edge definition, recover eye detail, lip definition, and skin texture from motion blur. Output as professional high resolution color camera RAW image",
    
    lora1_enabled: true,
    lora1_name: "senzu/klein9B_adonis_refine.safetensors",
    lora1_strength: 1.0,
    lora2_enabled: true,
    lora2_name: "senzu/Flux2-Klein-9B-consistency-V2.safetensors",
    lora2_strength: 0.5,
    lora3_enabled: false, lora3_name: "none.safetensors", lora3_strength: 0,
    lora4_enabled: false, lora4_name: "none.safetensors", lora4_strength: 0,
    lora5_enabled: false, lora5_name: "none.safetensors", lora5_strength: 0,
    lora6_enabled: false, lora6_name: "none.safetensors", lora6_strength: 0,
    
    dit_model: "seedvr2_ema_7b_fp8_e4m3fn_mixed_block35_fp16.safetensors",
    blocks_to_swap: 36,
    attention_mode: "flash_attn_2",
    color_correction: "lab",
    resolution: 2048,
    max_resolution: 4096,
    max_input_resolution: 768,
    randomize_seed: true,
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
    offload_device: "cpu"
  },
  "User Custom": {
    mode: "full",
    model_pack: "FP8 Standard",
    unet_name: "Flux2-Klein-9B-True-v2-fp8mixed.safetensors",
    clip_name: "qwen_3_8b_fp8mixed.safetensors",
    vae_name: "flux2-vae.safetensors",
    use_gguf: false,
    steps: 4,
    cfg: 1.0,
    megapixels: 1.0,
    sampler_name: "euler",
    randomize_seed: true,
    negative_prompt: "",
    prompt: "",
    lora1_enabled: false, lora1_name: "none.safetensors", lora1_strength: 0,
    lora2_enabled: false, lora2_name: "none.safetensors", lora2_strength: 0,
    lora3_enabled: false, lora3_name: "none.safetensors", lora3_strength: 0,
    lora4_enabled: false, lora4_name: "none.safetensors", lora4_strength: 0,
    lora5_enabled: false, lora5_name: "none.safetensors", lora5_strength: 0,
    lora6_enabled: false, lora6_name: "none.safetensors", lora6_strength: 0,
    dit_model: "seedvr2_ema_7b_fp8_e4m3fn_mixed_block35_fp16.safetensors",
    blocks_to_swap: 36,
    attention_mode: "flash_attn_2",
    color_correction: "lab",
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
    offload_device: "cpu"
  }
};

function ensurePresetsExist() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(PRESETS_FILE)) {
    fs.writeFileSync(PRESETS_FILE, JSON.stringify(DEFAULT_PRESET, null, 2), 'utf-8');
  }
}

function loadPresets() {
  ensurePresetsExist();
  try {
    const data = fs.readFileSync(PRESETS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (err) {
    console.error("Error reading presets:", err);
    return DEFAULT_PRESET;
  }
}

function savePreset(name, data) {
  ensurePresetsExist();
  const presets = loadPresets();
  presets[name] = data;
  try {
    fs.writeFileSync(PRESETS_FILE, JSON.stringify(presets, null, 2), 'utf-8');
    return true;
  } catch (err) {
    console.error("Error saving preset:", err);
    return false;
  }
}

function deletePreset(name) {
  ensurePresetsExist();
  const presets = loadPresets();
  if (presets[name]) {
    delete presets[name];
    try {
      fs.writeFileSync(PRESETS_FILE, JSON.stringify(presets, null, 2), 'utf-8');
      return true;
    } catch (err) {
      console.error("Error deleting preset:", err);
      return false;
    }
  }
  return false;
}

module.exports = {
  loadPresets,
  savePreset,
  deletePreset,
  DEFAULT_PRESET
};
