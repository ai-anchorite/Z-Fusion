const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

// install.js only clones the INT8-Fast-ROCm custom node when Pinokio detects an
// AMD/ROCm system, so the node's presence is the gate for the INT8 loader UI.
// Without it, switching the workflow to OTUNetLoaderW8A8 would fail anyway.
const INT8_NODE_DIR = path.resolve(__dirname, '../comfyui/custom_nodes/ComfyUI-INT8-Fast-ROCM');

function getStats() {
  const result = {
    gpu: null,
    int8_available: fs.existsSync(INT8_NODE_DIR),
    ram: { used: 0, total: 0 },
    available: false
  };

  // RAM stats (cross-platform via os module)
  const totalRam = os.totalmem() / (1024 * 1024 * 1024);
  const freeRam = os.freemem() / (1024 * 1024 * 1024);
  result.ram = {
    used: +(totalRam - freeRam).toFixed(1),
    total: +totalRam.toFixed(1)
  };

  // GPU stats via nvidia-smi
  try {
    const gpuQuery = execSync(
      'nvidia-smi --query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu --format=csv,noheader,nounits',
      { timeout: 5000, encoding: 'utf8' }
    ).trim();

    if (gpuQuery) {
      const parts = gpuQuery.split(',').map(s => s.trim());
      result.gpu = {
        name: parts[0],
        utilization: parseInt(parts[1], 10) || 0,
        memory_used: +(parseInt(parts[2], 10) / 1024).toFixed(1),
        memory_total: +(parseInt(parts[3], 10) / 1024).toFixed(1),
        temperature: parseInt(parts[4], 10) || 0
      };
      result.available = true;
    }
  } catch (_) {
    // No NVIDIA GPU or nvidia-smi unavailable
  }

  return result;
}

module.exports = { getStats };
