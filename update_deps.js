// Update payload — always executed from the freshly-pulled version.
// Add new custom nodes, pip packages, and other update steps here.
// Never add steps to update.js directly — put them here instead.
module.exports = {
  run: [
    // Pull / clone all submodules and custom nodes
    {
      method: "shell.run",
      params: {
        path: "app",
        message: [
          "git -C comfyui pull || git clone https://github.com/comfyanonymous/ComfyUI.git comfyui",
          "git -C comfyui/custom_nodes/ComfyUI-Manager pull || git clone https://github.com/ltdrdata/ComfyUI-Manager.git comfyui/custom_nodes/ComfyUI-Manager",
          "git -C comfyui/custom_nodes/ComfyUI-GGUF pull || git clone https://github.com/city96/ComfyUI-GGUF.git comfyui/custom_nodes/ComfyUI-GGUF",
          "git -C comfyui/custom_nodes/ComfyUI-SeedVR2_VideoUpscaler pull || git clone https://github.com/numz/ComfyUI-SeedVR2_VideoUpscaler.git comfyui/custom_nodes/ComfyUI-SeedVR2_VideoUpscaler",
          "git -C comfyui/custom_nodes/ComfyUI-VideoHelperSuite pull || git clone https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite.git comfyui/custom_nodes/ComfyUI-VideoHelperSuite",
          "git -C comfyui/custom_nodes/SeedVarianceEnhancer pull || git clone https://github.com/ChangeTheConstants/SeedVarianceEnhancer.git comfyui/custom_nodes/SeedVarianceEnhancer",
          "git -C comfyui/custom_nodes/ComfyUI-JoyCaption pull || git clone https://github.com/1038lab/ComfyUI-JoyCaption.git comfyui/custom_nodes/ComfyUI-JoyCaption",
          "git -C comfyui/custom_nodes/comfyui_essentials pull || git clone https://github.com/cubiq/ComfyUI_essentials.git comfyui/custom_nodes/comfyui_essentials",
          "git -C comfyui/custom_nodes/comfyui-easy-use pull || git clone https://github.com/yolain/ComfyUI-Easy-Use.git comfyui/custom_nodes/comfyui-easy-use",
          "git -C comfyui/custom_nodes/ComfyUI-EulerDiscreteScheduler pull || git clone https://github.com/erosDiffusion/ComfyUI-EulerDiscreteScheduler.git comfyui/custom_nodes/ComfyUI-EulerDiscreteScheduler",
          "git -C CameraPromptsGenerator pull || git clone https://github.com/demon4932/CameraPromptsGenerator.git CameraPromptsGenerator",
          "git -C comfyui/custom_nodes/comfyui-krea2edit pull || git clone https://github.com/lbouaraba/comfyui-krea2edit.git comfyui/custom_nodes/comfyui-krea2edit",
          "git -C comfyui/custom_nodes/ComfyUI-RMBG pull || git clone https://github.com/1038lab/ComfyUI-RMBG.git comfyui/custom_nodes/ComfyUI-RMBG",
          "{{platform === 'win32' && gpu === 'amd' ? 'git -C comfyui/custom_nodes/ComfyUI-INT8-Fast-ROCM pull || git clone https://github.com/patientx/ComfyUI-INT8-Fast-ROCM comfyui/custom_nodes/ComfyUI-INT8-Fast-ROCM' : ''}}",
        ]
      }
    },

    // Ensure custom wildcard node files are in place
    // We've updated this custom node, so copying in updated file
    {
      // when: "{{!exists('app/comfyui/custom_nodes/z-image-wildcards/__init__.py')}}",
      method: "fs.copy",
      params: {
        src: "app/custom_nodes/z-image-wildcards/__init__.py",
        dest: "app/comfyui/custom_nodes/z-image-wildcards/__init__.py"
      }
    },
    {
      // when: "{{!exists('app/comfyui/custom_nodes/z-image-wildcards/wildcards_node.py')}}",
      method: "fs.copy",
      params: {
        src: "app/custom_nodes/z-image-wildcards/wildcards_node.py",
        dest: "app/comfyui/custom_nodes/z-image-wildcards/wildcards_node.py"
      }
    },

    // Install / update Python dependencies
    {
      method: "shell.run",
      params: {
        venv: "env",
        path: "app",
        message: [
          "uv pip install -r comfyui/requirements.txt",
          "uv pip install -r requirements.txt",
          "uv pip install gguf>=0.13.0 sentencepiece protobuf",
          "uv pip install einops omegaconf>=2.3.0 diffusers>=0.33.1 peft>=0.17.0 rotary_embedding_torch>=0.5.3 opencv-python matplotlib imageio-ffmpeg bitsandbytes>=0.42.0 compressed-tensors>=0.6.0",
          "uv pip install numba colour-science color-matcher mss rembg pixeloe transparent-background clip_interrogator>=0.6.0 lark opencv-python-headless",
          "uv pip install onnxruntime" // wd14 tagger
        ]
      }
    },

    // Update torch / xformers / attention libs
    {
      method: "script.start",
      params: {
        uri: "torch.js",
        params: {
          venv: "env",
          path: "app"
        }
      }
    }
  ]
}
