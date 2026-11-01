module.exports = {
  run: [
    // windows GTX10 / GTX16
    {
      "when": "{{platform === 'win32' && gpu === 'nvidia' && kernel.gpu_model && / (10|16)\\d+/.test(kernel.gpu_model)}}",
      "method": "shell.run",
      "params": {
        "venv": "{{args && args.venv ? args.venv : null}}",
        "path": "{{args && args.path ? args.path : '.'}}",
        "message": [
          "uv pip install torch==2.7.1 torchvision==0.22.1 torchaudio==2.7.1 {{args && args.xformers ? 'xformers==0.0.30' : ''}} --index-url https://download.pytorch.org/whl/cu128 --force-reinstall --no-deps"
        ]
      },
      "next": null
    },
    // windows RTX20
    {
      "when": "{{platform === 'win32' && gpu === 'nvidia' && kernel.gpu_model && / 20.+/.test(kernel.gpu_model)}}",
      "method": "shell.run",
      "params": {
        "venv": "{{args && args.venv ? args.venv : null}}",
        "path": "{{args && args.path ? args.path : '.'}}",
        "message": [
          "uv pip install torch==2.10.0 torchvision==0.25.0 torchaudio==2.10.0 {{args && args.xformers ? 'xformers==0.0.34' : ''}} --index-url https://download.pytorch.org/whl/cu130 --force-reinstall --no-deps",
          "uv pip install -U triton-windows",
          "uv pip install sageattention==1.0.6",
          "uv pip install https://github.com/deepbeepmeep/kernels/releases/download/GGUF_Kernels/llamacpp_gguf_cuda-1.0.2+torch210cu13py311-cp311-cp311-win_amd64.whl",
          "uv pip install bitsandbytes==0.49.2 --no-deps"
        ]
      },
      "next": null
    },
    // windows RTX50
    {
      "when": "{{platform === 'win32' && gpu === 'nvidia' && kernel.gpu_model && / 50.+/.test(kernel.gpu_model)}}",
      "method": "shell.run",
      "params": {
        "venv": "{{args && args.venv ? args.venv : null}}",
        "path": "{{args && args.path ? args.path : '.'}}",
        "message": [
          "uv pip install torch==2.10.0 torchvision==0.25.0 torchaudio==2.10.0 {{args && args.xformers ? 'xformers==0.0.34' : ''}} --index-url https://download.pytorch.org/whl/cu130 --force-reinstall --no-deps",
          "uv pip install -U triton-windows",
          "uv pip install https://github.com/woct0rdho/SageAttention/releases/download/v2.2.0-windows.post4/sageattention-2.2.0+cu130torch2.9.0andhigher.post4-cp39-abi3-win_amd64.whl",
          "uv pip install https://github.com/mjun0812/flash-attention-prebuild-wheels/releases/download/v0.7.13/flash_attn-2.8.3+cu130torch2.10-cp311-cp311-win_amd64.whl",
          "uv pip install bitsandbytes==0.49.2 --no-deps"
        ]
      },
      "next": null
    },
    // windows RTX30 / RTX40
    {
      "when": "{{platform === 'win32' && gpu === 'nvidia'}}",
      "method": "shell.run",
      "params": {
        "venv": "{{args && args.venv ? args.venv : null}}",
        "path": "{{args && args.path ? args.path : '.'}}",
        "message": [
          "uv pip install torch==2.10.0 torchvision==0.25.0 torchaudio==2.10.0 {{args && args.xformers ? 'xformers==0.0.34' : ''}} --index-url https://download.pytorch.org/whl/cu130 --force-reinstall --no-deps",
          "uv pip install -U triton-windows",
          "uv pip install https://github.com/woct0rdho/SageAttention/releases/download/v2.2.0-windows.post4/sageattention-2.2.0+cu130torch2.9.0andhigher.post4-cp39-abi3-win_amd64.whl",
          "uv pip install https://github.com/mjun0812/flash-attention-prebuild-wheels/releases/download/v0.7.13/flash_attn-2.8.3+cu130torch2.10-cp311-cp311-win_amd64.whl",
          "uv pip install bitsandbytes==0.49.2 --no-deps"
        ]
      },
      "next": null
    },
    // RDNA 1 (5000s)
    {
      "when": "{{platform === 'win32' && gpu === 'amd' && /^gfx101[012]$/.test(gpu_target)}}",
      "method": "shell.run",
      "params": {
        "bluefairy": "off",
        "env": { "UV_SKIP_WHEEL_FILENAME_CHECK": "1" },
        "venv": "{{args && args.venv ? args.venv : null}}",
        "path": "{{args && args.path ? args.path : '.'}}",
        "message": "uv pip install --pre torch torchvision torchaudio --index-url https://rocm.nightlies.amd.com/v2-staging/gfx101X-dgpu --force-reinstall"
      },
      "next": null
    },
    // RDNA 2 (6000s)
    {
      "when": "{{platform === 'win32' && gpu === 'amd' && /^gfx103[0124]$/.test(gpu_target)}}",
      "method": "shell.run",
      "params": {
        "bluefairy": "off",
        "env": { "UV_SKIP_WHEEL_FILENAME_CHECK": "1" },
        "venv": "{{args && args.venv ? args.venv : null}}",
        "path": "{{args && args.path ? args.path : '.'}}",
        "message": "uv pip install --pre torch torchvision torchaudio --index-url https://rocm.nightlies.amd.com/v2-staging/gfx103X-dgpu --force-reinstall"
      },
      "next": null
    },
    // RDNA 3 (7000/8000s)
    {
      "when": "{{platform === 'win32' && gpu === 'amd' && /^gfx110[012]$/.test(gpu_target)}}",
      "method": "shell.run",
      "params": {
        "bluefairy": "off",
        "env": { "UV_SKIP_WHEEL_FILENAME_CHECK": "1" },
        "venv": "{{args && args.venv ? args.venv : null}}",
        "path": "{{args && args.path ? args.path : '.'}}",
        "message": "uv pip install --pre torch torchvision torchaudio --index-url https://rocm.nightlies.amd.com/v2-staging/gfx110X-all --force-reinstall"
      },
      "next": null
    },
    // RDNA 4 (9000s)
    {
      "when": "{{platform === 'win32' && gpu === 'amd' && /^gfx120[01]$/.test(gpu_target)}}",
      "method": "shell.run",
      "params": {
        "bluefairy": "off",
        "env": { "UV_SKIP_WHEEL_FILENAME_CHECK": "1" },
        "venv": "{{args && args.venv ? args.venv : null}}",
        "path": "{{args && args.path ? args.path : '.'}}",
        "message": "uv pip install --pre torch torchvision torchaudio --index-url https://rocm.nightlies.amd.com/v2-staging/gfx120X-all --force-reinstall"
      },
      "next": null
    },
    // STRIX POINT (880M/890M / gfx1150)
    {
      "when": "{{platform === 'win32' && gpu === 'amd' && /^gfx1150$/.test(gpu_target)}}",
      "method": "shell.run",
      "params": {
        "bluefairy": "off",
        "env": { "UV_SKIP_WHEEL_FILENAME_CHECK": "1" },
        "venv": "{{args && args.venv ? args.venv : null}}",
        "path": "{{args && args.path ? args.path : '.'}}",
        "message": "uv pip install --pre torch torchvision torchaudio --index-url https://rocm.nightlies.amd.com/v2-staging/gfx1150 --force-reinstall"
      },
      "next": null
    },
    // STRIX HALO (8060s / gfx1151)
    {
      "when": "{{platform === 'win32' && gpu === 'amd' && /^gfx1151$/.test(gpu_target)}}",
      "method": "shell.run",
      "params": {
        "bluefairy": "off",
        "env": { "UV_SKIP_WHEEL_FILENAME_CHECK": "1" },
        "venv": "{{args && args.venv ? args.venv : null}}",
        "path": "{{args && args.path ? args.path : '.'}}",
        "message": "uv pip install --pre torch torchvision torchaudio --index-url https://rocm.nightlies.amd.com/v2-staging/gfx1151 --force-reinstall"
      },
      "next": null
    },
    // linux GTX10 / GTX16
    {
      "when": "{{platform === 'linux' && gpu === 'nvidia' && kernel.gpu_model && / (10|16)\\d+/.test(kernel.gpu_model)}}",
      "method": "shell.run",
      "params": {
        "bluefairy": "off",
        "venv": "{{args && args.venv ? args.venv : null}}",
        "path": "{{args && args.path ? args.path : '.'}}",
        "message": [
          "uv pip install torch==2.7.0 torchvision==0.22.0 torchaudio==2.7.0 {{args && args.xformers ? 'xformers==0.0.30' : ''}} --index-url https://download.pytorch.org/whl/cu128 --force-reinstall",
          "uv pip install numpy==2.1.2"
        ]
      },
      "next": null
    },
    // linux RTX20
    {
      "when": "{{platform === 'linux' && gpu === 'nvidia' && kernel.gpu_model && / 20.+/.test(kernel.gpu_model)}}",
      "method": "shell.run",
      "params": {
        "bluefairy": "off",
        "venv": "{{args && args.venv ? args.venv : null}}",
        "path": "{{args && args.path ? args.path : '.'}}",
        "message": [
          "uv pip install torch==2.10.0 torchvision==0.25.0 torchaudio==2.10.0 {{args && args.xformers ? 'xformers==0.0.34' : ''}} --index-url https://download.pytorch.org/whl/cu130 --force-reinstall",
          "uv pip install ../wheel/sageattention-2.2.0-cp311-cp311-linux_x86_64.whl",
          "uv pip install numpy==2.1.2",
          "uv pip install bitsandbytes==0.49.2 --no-deps"
        ]
      },
      "next": null
    },
    // linux RTX50
    {
      "when": "{{platform === 'linux'}}",
      "method": "shell.run",
      "params": {
        "bluefairy": "off",
        "venv": "{{args && args.venv ? args.venv : null}}",
        "path": "{{args && args.path ? args.path : '.'}}",
        "message": [
          "uv pip install torch==2.10.0 torchvision==0.25.0 torchaudio==2.10.0 {{args && args.xformers ? 'xformers==0.0.34' : ''}} --index-url https://download.pytorch.org/whl/cu130 --force-reinstall",
          "uv pip install ../wheel/sageattention-2.2.0-cp311-cp311-linux_x86_64.whl",
          "uv pip install https://github.com/mjun0812/flash-attention-prebuild-wheels/releases/download/v0.7.16/flash_attn-2.8.3+cu130torch2.10-cp311-cp311-linux_x86_64.whl",
          "uv pip install numpy==2.1.2",
          "uv pip install bitsandbytes==0.49.2 --no-deps"
        ]
      },
      "next": null
    },
    // linux RTX30 / RTX40
    {
      "when": "{{platform === 'linux'}}",
      "method": "shell.run",
      "params": {
        "bluefairy": "off",
        "venv": "{{args && args.venv ? args.venv : null}}",
        "path": "{{args && args.path ? args.path : '.'}}",
        "message": [
          "uv pip install torch==2.10.0 torchvision==0.25.0 torchaudio==2.10.0 {{args && args.xformers ? 'xformers==0.0.34' : ''}} --index-url https://download.pytorch.org/whl/cu130 --force-reinstall",
          "uv pip install ../wheel/sageattention-2.2.0-cp311-cp311-linux_x86_64.whl",
          "uv pip install https://github.com/mjun0812/flash-attention-prebuild-wheels/releases/download/v0.7.16/flash_attn-2.8.3+cu130torch2.10-cp311-cp311-linux_x86_64.whl",
          "uv pip install numpy==2.1.2",
          "uv pip install bitsandbytes==0.49.2 --no-deps"
        ]
      },
      "next": null
    },
    // linux rocm (amd)
    {
      "when": "{{platform === 'linux' && gpu === 'amd'}}",
      "method": "shell.run",
      "params": {
        "bluefairy": "off",
        "venv": "{{args && args.venv ? args.venv : null}}",
        "path": "{{args && args.path ? args.path : '.'}}",
        "message": [
          "uv pip install torch==2.10.0 torchvision torchaudio --index-url https://download.pytorch.org/whl/rocm7.1 --force-reinstall",
          "uv pip install bitsandbytes==0.49.2 --no-deps"
        ]
      },
      "next": null
    },
    // apple silicon mac
    {
      "when": "{{platform === 'darwin' && arch === 'arm64'}}",
      "method": "shell.run",
      "params": {
        "venv": "{{args && args.venv ? args.venv : null}}",
        "path": "{{args && args.path ? args.path : '.'}}",
        "message": "uv pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cpu --force-reinstall --no-deps"
      }
    }
  ]
}
