module.exports = {
  run: [

    {
      method: "shell.run",
      params: {
        message: "git pull"
      }
    },

    {
      method: "shell.run",
      params: {
        path: "app",
        message: [
          "git -C comfyui pull || git clone https://github.com/comfyanonymous/ComfyUI.git comfyui",
          "git -C comfyui/custom_nodes/ComfyUI-Manager pull || git clone https://github.com/ltdrdata/ComfyUI-Manager.git comfyui/custom_nodes/ComfyUI-Manager",
          "git -C comfyui/custom_nodes/ComfyUI-GGUF pull || git clone https://github.com/city96/ComfyUI-GGUF.git comfyui/custom_nodes/ComfyUI-GGUF",
          "git -C comfyui/custom_nodes/ComfyUI-SeedVR2_VideoUpscaler pull || git clone https://github.com/SeedVR2/ComfyUI-SeedVR2_VideoUpscaler.git comfyui/custom_nodes/ComfyUI-SeedVR2_VideoUpscaler",
          "git -C comfyui/custom_nodes/ComfyUI-VideoHelperSuite pull || git clone https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite.git comfyui/custom_nodes/ComfyUI-VideoHelperSuite",
          "git -C comfyui/custom_nodes/SeedVarianceEnhancer pull || git clone https://github.com/ChangeTheConstants/SeedVarianceEnhancer.git comfyui/custom_nodes/SeedVarianceEnhancer",
          "git -C CameraPromptsGenerator pull || git clone https://github.com/demon4932/CameraPromptsGenerator.git CameraPromptsGenerator"
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
        }
      }
    }
  ]
}