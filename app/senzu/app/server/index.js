const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');

const comfy = require('./comfyui');
const presets = require('./presets');
const prompts = require('./prompts');

const app = express();
const PORT = process.env.PORT || 4242;

// Absolute workspace folders mapping
const APP_ROOT = path.resolve(__dirname, '../../..');
const MODELS_ROOT = path.join(APP_ROOT, 'comfyui/models');
const OUTPUTS_ROOT = path.join(APP_ROOT, 'outputs');
const SENZU_OUTPUTS = path.join(OUTPUTS_ROOT, 'senzu');
const WORKFLOWS_DIR = path.resolve(__dirname, '../workflows');
const DATA_DIR = path.resolve(__dirname, '../data');

// Ensure directories exist
if (!fs.existsSync(SENZU_OUTPUTS)) {
  fs.mkdirSync(SENZU_OUTPUTS, { recursive: true });
}
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
const TEMP_DIR = path.join(DATA_DIR, 'temp');
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// Multer storage
const upload = multer({ dest: TEMP_DIR });

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Serve frontend static assets
app.use(express.static(path.resolve(__dirname, '../public')));

// Serve outputs static directory
app.use('/outputs', express.static(OUTPUTS_ROOT));

// Standard active download tracker
let currentDownload = {
  filename: '',
  repo: '',
  progress: 0,
  speed: '0 B/s',
  downloaded: 0,
  total: 0,
  status: 'idle',
  error: null
};

// Recursive downloader with redirects
function downloadFileWithProgress(urlStr, destPath, onProgress) {
  return new Promise((resolve, reject) => {
    let req;
    try {
      const parsedUrl = new URL(urlStr);
      const client = parsedUrl.protocol === 'https:' ? https : http;
      
      req = client.get(urlStr, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          const redirectUrl = res.headers.location;
          console.log(`Following redirect to: ${redirectUrl}`);
          return downloadFileWithProgress(redirectUrl, destPath, onProgress)
            .then(resolve)
            .catch(reject);
        }
        
        if (res.statusCode !== 200) {
          return reject(new Error(`Failed to download: Status Code ${res.statusCode}`));
        }
        
        const totalBytes = parseInt(res.headers['content-length'], 10) || 0;
        let downloadedBytes = 0;
        let startTime = Date.now();
        
        const dir = path.dirname(destPath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        
        const fileStream = fs.createWriteStream(destPath);
        
        res.on('data', (chunk) => {
          downloadedBytes += chunk.length;
          fileStream.write(chunk);
          
          if (onProgress) {
            const elapsed = (Date.now() - startTime) / 1000;
            const speedBytes = elapsed > 0 ? downloadedBytes / elapsed : 0;
            let speedStr = '';
            if (speedBytes > 1024 * 1024) {
              speedStr = `${(speedBytes / (1024 * 1024)).toFixed(1)} MB/s`;
            } else if (speedBytes > 1024) {
              speedStr = `${(speedBytes / 1024).toFixed(1)} KB/s`;
            } else {
              speedStr = `${speedBytes.toFixed(0)} B/s`;
            }
            
            const progress = totalBytes > 0 ? (downloadedBytes / totalBytes) * 100 : 0;
            onProgress({
              downloaded: downloadedBytes,
              total: totalBytes,
              progress: progress,
              speed: speedStr
            });
          }
        });
        
        res.on('end', () => {
          fileStream.end();
          resolve();
        });
        
        res.on('error', (err) => {
          fileStream.close();
          if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
          reject(err);
        });
        
        fileStream.on('error', (err) => {
          fileStream.close();
          if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
          reject(err);
        });
      });
      
      req.on('error', (err) => {
        reject(err);
      });
    } catch (e) {
      reject(e);
    }
  });
}

// Presets CRUD APIs
app.get('/api/presets', (req, res) => {
  res.json(presets.loadPresets());
});

app.post('/api/presets', (req, res) => {
  const { name, data } = req.body;
  if (!name || !data) {
    return res.status(400).json({ error: "Missing name or data" });
  }
  const ok = presets.savePreset(name, data);
  if (ok) {
    res.json({ success: true });
  } else {
    res.status(500).json({ error: "Failed to save preset" });
  }
});

app.delete('/api/presets/:name', (req, res) => {
  const { name } = req.params;
  const ok = presets.deletePreset(name);
  if (ok) {
    res.json({ success: true });
  } else {
    res.status(404).json({ error: "Preset not found" });
  }
});

// Prompts CRUD APIs
app.get('/api/prompts', (req, res) => {
  res.json(prompts.loadPrompts());
});

app.post('/api/prompts', (req, res) => {
  const { name, content } = req.body;
  if (!name || !content) {
    return res.status(400).json({ error: "Missing name or content" });
  }
  const ok = prompts.savePrompt(name, content);
  if (ok) {
    res.json({ success: true });
  } else {
    res.status(500).json({ error: "Failed to save prompt" });
  }
});

app.delete('/api/prompts/:name', (req, res) => {
  const { name } = req.params;
  const ok = prompts.deletePrompt(name);
  if (ok) {
    res.json({ success: true });
  } else {
    res.status(404).json({ error: "Prompt not found" });
  }
});

app.post('/api/prompts/reset', (req, res) => {
  const ok = prompts.resetPromptsToDefaults();
  if (ok) {
    res.json({ success: true, prompts: prompts.loadPrompts() });
  } else {
    res.status(500).json({ error: "Failed to reset prompts" });
  }
});

// Models scanning API
app.get('/api/models', (req, res) => {
  const dirs = {
    diffusion_models: path.join(MODELS_ROOT, 'diffusion_models'),
    text_encoders: path.join(MODELS_ROOT, 'text_encoders'),
    vae: path.join(MODELS_ROOT, 'vae'),
    loras: path.join(MODELS_ROOT, 'loras'),
    seedvr2: path.join(MODELS_ROOT, 'SEEDVR2')
  };

  const result = {};

  for (const [key, dir] of Object.entries(dirs)) {
    result[key] = [];
    if (fs.existsSync(dir)) {
      try {
        const files = fs.readdirSync(dir, { recursive: true });
        result[key] = files.filter(file => {
          const ext = path.extname(file).toLowerCase();
          return ['.safetensors', '.ckpt', '.gguf', '.pth', '.bin'].includes(ext);
        }).map(file => file.replace(/\\/g, '/'));
      } catch (err) {
        console.error(`Error scanning ${key}:`, err);
      }
    }
  }

  res.json(result);
});

// Check if ComfyUI is online API
app.get('/api/status', async (req, res) => {
  const isOnline = await comfy.checkComfyOnline();
  res.json({ comfyOnline: isOnline });
});

// HF Model Download APIs
app.get('/api/models/download-status', (req, res) => {
  res.json(currentDownload);
});

app.post('/api/models/download', (req, res) => {
  if (currentDownload.status === 'downloading') {
    return res.status(400).json({ error: "A download is already in progress" });
  }

  const { repo, filename, type } = req.body;
  if (!repo || !filename || !type) {
    return res.status(400).json({ error: "Missing repo, filename, or type" });
  }

  let destDir = '';
  switch (type) {
    case 'unet':
      destDir = path.join(MODELS_ROOT, 'diffusion_models');
      break;
    case 'text_encoder':
      destDir = path.join(MODELS_ROOT, 'text_encoders');
      break;
    case 'vae':
      destDir = path.join(MODELS_ROOT, 'vae');
      break;
    case 'lora':
      destDir = path.join(MODELS_ROOT, 'loras');
      break;
    case 'seedvr2':
      destDir = path.join(MODELS_ROOT, 'SEEDVR2');
      break;
    default:
      return res.status(400).json({ error: "Invalid model type specified" });
  }

  const destPath = path.join(destDir, filename);
  const url = `https://huggingface.co/${repo}/resolve/main/${filename}`;

  currentDownload = {
    filename,
    repo,
    progress: 0,
    speed: '0 B/s',
    downloaded: 0,
    total: 0,
    status: 'downloading',
    error: null
  };

  // Start download asynchronously
  console.log(`Starting HF model download: ${url} -> ${destPath}`);
  downloadFileWithProgress(url, destPath, (p) => {
    currentDownload.downloaded = p.downloaded;
    currentDownload.total = p.total;
    currentDownload.progress = p.progress;
    currentDownload.speed = p.speed;
  }).then(() => {
    currentDownload.status = 'completed';
    currentDownload.progress = 100;
    console.log(`Model download complete: ${filename}`);
  }).catch((err) => {
    currentDownload.status = 'error';
    currentDownload.error = err.message;
    console.error(`Error downloading model:`, err);
  });

  res.json({ success: true, message: "Download started in background" });
});

// Unified Enhance API (supports upload + execution)
app.post('/api/enhance', upload.single('image'), async (req, res) => {
  try {
    const isOnline = await comfy.checkComfyOnline();
    if (!isOnline) {
      return res.status(503).json({ error: "ComfyUI backend is offline. Please launch ComfyUI first." });
    }

    const { mode, parameters: rawParams } = req.body;
    if (!mode) {
      return res.status(400).json({ error: "Missing workflow mode" });
    }

    let parsedParams = {};
    if (rawParams) {
      try {
        parsedParams = typeof rawParams === 'string' ? JSON.parse(rawParams) : rawParams;
      } catch (err) {
        return res.status(400).json({ error: "Invalid parameters format" });
      }
    }

    // Determine input image
    let inputImagePath = '';
    if (req.file) {
      inputImagePath = req.file.path;
    } else if (parsedParams.input_image_path) {
      inputImagePath = parsedParams.input_image_path;
    } else {
      return res.status(400).json({ error: "No input image provided" });
    }

    const timestamp = Date.now();
    const randomizeSeed = parsedParams.randomize_seed !== false;
    
    // Step 1: Run Edit if mode is full or edit
    let editResult = null;
    let editOutPath = '';
    
    if (mode === 'full' || mode === 'edit') {
      const editWorkflowName = parsedParams.use_gguf ? 'senzu_edit_gguf.json' : 'senzu_edit.json';
      const editWorkflowPath = path.join(WORKFLOWS_DIR, editWorkflowName);
      
      const seedVal = randomizeSeed ? Math.floor(Math.random() * 1000000000) : (parseInt(parsedParams.seed, 10) || 0);

      // Build parameters specific to edit workflow
      const editParams = {
        image1: inputImagePath,
        sampler_name: parsedParams.sampler_name || 'euler',
        seed: seedVal,
        unet_name: parsedParams.unet_name || 'flux-2-klein-9b-kv-fp8.safetensors',
        clip_name: parsedParams.clip_name || 'qwen_3_8b_fp8mixed.safetensors',
        prompt: parsedParams.prompt || '',
        negative_prompt: parsedParams.negative_prompt || '',
        vae_name: parsedParams.vae_name || 'flux2-vae.safetensors',
        megapixels: parseFloat(parsedParams.megapixels) || 1.0,
        cfg: parseFloat(parsedParams.cfg) || 1.0,
        steps: parseInt(parsedParams.steps, 10) || 4,
        
        lora1_name: parsedParams.lora1_enabled ? parsedParams.lora1_name : 'none.safetensors',
        lora1_strength: parsedParams.lora1_enabled ? parseFloat(parsedParams.lora1_strength) : 0,
        lora2_name: parsedParams.lora2_enabled ? parsedParams.lora2_name : 'none.safetensors',
        lora2_strength: parsedParams.lora2_enabled ? parseFloat(parsedParams.lora2_strength) : 0,
        lora3_name: parsedParams.lora3_enabled ? parsedParams.lora3_name : 'none.safetensors',
        lora3_strength: parsedParams.lora3_enabled ? parseFloat(parsedParams.lora3_strength) : 0,
        lora4_name: parsedParams.lora4_enabled ? parsedParams.lora4_name : 'none.safetensors',
        lora4_strength: parsedParams.lora4_enabled ? parseFloat(parsedParams.lora4_strength) : 0,
        lora5_name: parsedParams.lora5_enabled ? parsedParams.lora5_name : 'none.safetensors',
        lora5_strength: parsedParams.lora5_enabled ? parseFloat(parsedParams.lora5_strength) : 0,
        lora6_name: parsedParams.lora6_enabled ? parsedParams.lora6_name : 'none.safetensors',
        lora6_strength: parsedParams.lora6_enabled ? parseFloat(parsedParams.lora6_strength) : 0
      };

      console.log(`[Enhance] Running Edit Step with workflow ${editWorkflowName}...`);
      editResult = await comfy.runWorkflow(editWorkflowPath, 'edit', editParams);
      
      // Save output locally
      editOutPath = path.join(SENZU_OUTPUTS, `edit_${timestamp}.png`);
      await comfy.downloadComfyImage(editResult.filename, editResult.subfolder, editResult.type, editOutPath);
      console.log(`[Enhance] Edit Step complete. Saved to ${editOutPath}`);
    }

    // Step 2: Run Upscale if mode is full or upscale
    let upscaleResult = null;
    let upscaleOutPath = '';
    
    if (mode === 'full' || mode === 'upscale') {
      const upscaleWorkflowPath = path.join(WORKFLOWS_DIR, 'senzu_upscale.json');
      
      // If full mode, intermediate input is the output of edit. Otherwise, original input image
      const upscaleInputImage = mode === 'full' ? editOutPath : inputImagePath;
      const seedVal = randomizeSeed ? Math.floor(Math.random() * 1000000000) : (parseInt(parsedParams.seed, 10) || 42);

      const upscaleParams = {
        image: upscaleInputImage,
        seed: seedVal,
        resolution: parseInt(parsedParams.resolution, 10) || 2048,
        max_resolution: parseInt(parsedParams.max_resolution, 10) || 4096,
        batch_size: parseInt(parsedParams.batch_size, 10) || 1,
        uniform_batch_size: parsedParams.uniform_batch_size === true,
        color_correction: parsedParams.color_correction || 'lab',
        temporal_overlap: parseInt(parsedParams.temporal_overlap, 10) || 0,
        input_noise_scale: parseFloat(parsedParams.input_noise_scale) || 0.0,
        latent_noise_scale: parseFloat(parsedParams.latent_noise_scale) || 0.0,
        offload_device: parsedParams.offload_device || 'cpu',
        
        device: parsedParams.device || 'cuda:0',
        encode_tiled: parsedParams.encode_tiled !== false,
        encode_tile_size: parseInt(parsedParams.encode_tile_size, 10) || 1024,
        encode_tile_overlap: parseInt(parsedParams.encode_tile_overlap, 10) || 128,
        decode_tiled: parsedParams.decode_tiled !== false,
        decode_tile_size: parseInt(parsedParams.decode_tile_size, 10) || 1024,
        decode_tile_overlap: parseInt(parsedParams.decode_tile_overlap, 10) || 128,
        
        dit_model: parsedParams.dit_model || 'seedvr2_ema_7b_fp8_e4m3fn_mixed_block35_fp16.safetensors',
        dit_device: parsedParams.device || 'cuda:0',
        blocks_to_swap: parseInt(parsedParams.blocks_to_swap, 10) || 36,
        attention_mode: parsedParams.attention_mode || 'flash_attn_2'
      };

      console.log(`[Enhance] Running Upscale Step with workflow senzu_upscale.json...`);
      upscaleResult = await comfy.runWorkflow(upscaleWorkflowPath, 'upscale', upscaleParams);
      
      // Save output locally
      upscaleOutPath = path.join(SENZU_OUTPUTS, `upscale_${timestamp}.png`);
      await comfy.downloadComfyImage(upscaleResult.filename, upscaleResult.subfolder, upscaleResult.type, upscaleOutPath);
      console.log(`[Enhance] Upscale Step complete. Saved to ${upscaleOutPath}`);
    }

    // Clean up local temp uploaded file
    if (req.file && fs.existsSync(req.file.path)) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (err) {
        // Ignored
      }
    }

    // Return the appropriate response depending on mode
    const responsePayload = { success: true, mode };
    
    if (mode === 'edit') {
      responsePayload.output = `/outputs/senzu/${path.basename(editOutPath)}`;
      responsePayload.editOutput = responsePayload.output;
    } else if (mode === 'upscale') {
      responsePayload.output = `/outputs/senzu/${path.basename(upscaleOutPath)}`;
      responsePayload.upscaleOutput = responsePayload.output;
    } else if (mode === 'full') {
      responsePayload.output = `/outputs/senzu/${path.basename(upscaleOutPath)}`;
      responsePayload.editOutput = `/outputs/senzu/${path.basename(editOutPath)}`;
      responsePayload.upscaleOutput = responsePayload.output;
    }

    res.json(responsePayload);

  } catch (err) {
    console.error("Enhancement pipeline error:", err);
    
    // Cleanup uploaded file on error
    if (req.file && fs.existsSync(req.file.path)) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (cleanupErr) {
        // Ignored
      }
    }

    res.status(500).json({ error: err.message || "An unexpected error occurred during enhancement." });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`=================================================`);
  console.log(`Senzu Backend is running on port ${PORT}`);
  console.log(`Access at http://localhost:${PORT}`);
  console.log(`comfyui endpoint: ${comfy.COMFY_URL}`);
  console.log(`=================================================`);
});
