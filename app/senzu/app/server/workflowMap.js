module.exports = {
  edit: {
    image1: { node: "3", field: "image", upload: true },
    sampler_name: { node: "4", field: "sampler_name" },
    seed: { node: "7", field: "noise_seed" },
    unet_name: { node: "8", field: "unet_name" },
    clip_name: { node: "9", field: "clip_name" },
    prompt: { node: "10", field: "text" },
    negative_prompt: { node: "11", field: "text" },
    vae_name: { node: "12", field: "vae_name" },
    megapixels: { node: "16", field: "megapixels" },
    cfg: { node: "17", field: "cfg" },
    steps: { node: "18", field: "steps" },
    
    lora1_name: { node: "24", field: "lora_name" },
    lora1_strength: { node: "24", field: "strength_model" },
    lora2_name: { node: "23", field: "lora_name" },
    lora2_strength: { node: "23", field: "strength_model" },
    lora3_name: { node: "22", field: "lora_name" },
    lora3_strength: { node: "22", field: "strength_model" },
    lora4_name: { node: "19", field: "lora_name" },
    lora4_strength: { node: "19", field: "strength_model" },
    lora5_name: { node: "20", field: "lora_name" },
    lora5_strength: { node: "20", field: "strength_model" },
    lora6_name: { node: "21", field: "lora_name" },
    lora6_strength: { node: "21", field: "strength_model" }
  },
  upscale: {
    image: { node: "16", field: "image", upload: true },
    seed: { node: "10", field: "seed" },
    resolution: { node: "10", field: "resolution" },
    max_resolution: { node: "10", field: "max_resolution" },
    batch_size: { node: "10", field: "batch_size" },
    uniform_batch_size: { node: "10", field: "uniform_batch_size" },
    color_correction: { node: "10", field: "color_correction" },
    temporal_overlap: { node: "10", field: "temporal_overlap" },
    input_noise_scale: { node: "10", field: "input_noise_scale" },
    latent_noise_scale: { node: "10", field: "latent_noise_scale" },
    offload_device: { node: "10", field: "offload_device" },
    
    // SeedVR2LoadVAEModel (Node 13)
    device: { node: "13", field: "device" },
    encode_tiled: { node: "13", field: "encode_tiled" },
    encode_tile_size: { node: "13", field: "encode_tile_size" },
    encode_tile_overlap: { node: "13", field: "encode_tile_overlap" },
    decode_tiled: { node: "13", field: "decode_tiled" },
    decode_tile_size: { node: "13", field: "decode_tile_size" },
    decode_tile_overlap: { node: "13", field: "decode_tile_overlap" },
    
    // SeedVR2LoadDiTModel (Node 14)
    dit_model: { node: "14", field: "model" },
    dit_device: { node: "14", field: "device" },
    blocks_to_swap: { node: "14", field: "blocks_to_swap" },
    attention_mode: { node: "14", field: "attention_mode" }
  }
};
