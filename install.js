module.exports = {
  run: [
    {
      method: "shell.run",
      params: {
        message: [
          "git clone https://github.com/comfyanonymous/ComfyUI app/comfyui",
          "git clone https://github.com/ltdrdata/ComfyUI-Manager app/comfyui/custom_nodes/ComfyUI-Manager",
          "git clone https://github.com/city96/ComfyUI-GGUF app/comfyui/custom_nodes/ComfyUI-GGUF",
          "git clone https://github.com/numz/ComfyUI-SeedVR2_VideoUpscaler app/comfyui/custom_nodes/ComfyUI-SeedVR2_VideoUpscaler",
          "git clone https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite.git app/comfyui/custom_nodes/ComfyUI-VideoHelperSuite",
          "git clone https://github.com/ChangeTheConstants/SeedVarianceEnhancer.git app/comfyui/custom_nodes/SeedVarianceEnhancer",
          "git clone https://github.com/demon4932/CameraPromptsGenerator.git app/CameraPromptsGenerator"
        ]
      }
    },

    {
      method: "shell.run",
      params: {
        venv: "env",
        path: "app",
        message: [
          "uv pip install -r comfyui/requirements.txt",
          "uv pip install -r requirements.txt",
          "uv pip install gguf>=0.13.0 sentencepiece protobuf",
          "uv pip install einops omegaconf>=2.3.0 diffusers>=0.33.1 peft>=0.17.0 rotary_embedding_torch>=0.5.3 opencv-python matplotlib imageio-ffmpeg"
        ]
      }
    },

    {
      method: "script.start",
      params: {
        uri: "torch.js",
        params: {
          venv: "env",
          path: "app",
          flashattention: true,
          triton: true,
          sageattention: true,   
        }
      }
    },

    {
      method: "fs.link",
      params: {
        drive: {
          "checkpoints": "app/comfyui/models/checkpoints",
          "clip": "app/comfyui/models/clip",
          "clip_vision": "app/comfyui/models/clip_vision",
          "configs": "app/comfyui/models/configs",
          "controlnet": "app/comfyui/models/controlnet",
          "diffusers": "app/comfyui/models/diffusers",
          "diffusion_models": "app/comfyui/models/diffusion_models",
          "embeddings": "app/comfyui/models/embeddings",
          "gligen": "app/comfyui/models/gligen",
          "hypernetworks": "app/comfyui/models/hypernetworks",
          "ipadapter": "app/comfyui/models/ipadapter",
          "loras": "app/comfyui/models/loras",
          "photomaker": "app/comfyui/models/photomaker",
          "SEEDVR2": "app/comfyui/models/SEEDVR2",
          "model_patches": "app/comfyui/models/model_patches",
          "style_models": "app/comfyui/models/style_models",
          "text_encoders": "app/comfyui/models/text_encoders",
          "unet": "app/comfyui/models/unet",
          "upscale_models": "app/comfyui/models/upscale_models",
          "vae": "app/comfyui/models/vae",
          "vae_approx": "app/comfyui/models/VAE-approx",
          "output": "app/comfyui/output"
        },
        peers: [
          "https://github.com/cocktailpeanut/fluxgym.git",
          "https://github.com/cocktailpeanutlabs/automatic1111.git",
          "https://github.com/cocktailpeanutlabs/fooocus.git",
          "https://github.com/cocktailpeanutlabs/comfyui.git",
          "https://github.com/pinokiofactory/comfy.git",
          "https://github.com/pinokiofactory/stable-diffusion-webui-forge.git"
        ]
      }
    }
  ]
}