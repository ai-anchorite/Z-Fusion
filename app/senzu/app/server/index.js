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
const modelPacks = require('./model-packs');
const settings = require('./settings');
const sysStats = require('./system-stats');
const enhancerPrompts = require('./enhancer-prompts');
const genPresets = require('./gen-presets');
const genEnhancerPrompts = require('./gen-enhancer-prompts');
const { processDynamicPrompt } = require('./dynamicPrompt');

const GalleryDatabase = require('./database');
const { createGalleryRouter } = require('./gallery');
const scanner = require('./scanner');
const Parser = require('./crawler/parser');

// Last-resort guards: the backend also serves the web UI and the /api/status
// endpoint, so a stray async error must never take the whole process down
// (e.g. a filesystem-watcher failure). Log loudly and keep serving.
process.on('uncaughtException', (err) => {
  console.error('[Senzu] Uncaught exception (continuing):', err && err.stack ? err.stack : err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[Senzu] Unhandled rejection (continuing):', reason && reason.stack ? reason.stack : reason);
});

const app = express();
const PORT = process.env.PORT || 4242;

const candidateRoots = [
  path.resolve(__dirname, '../../../'),
];
let APP_ROOT = candidateRoots[0];
for (const r of candidateRoots) {
  if (fs.existsSync(path.join(r, 'comfyui/models'))) {
    APP_ROOT = r;
    break;
  }
}

const MODELS_ROOT = path.join(APP_ROOT, 'comfyui/models');
const OUTPUTS_ROOT = path.join(APP_ROOT, 'outputs');
const WORKFLOWS_DIR = path.resolve(__dirname, '../workflows');
const DATA_DIR = path.resolve(__dirname, '../data');
const OUTPUT_TEMP_DIR = path.join(DATA_DIR, 'output-temp');
const SENZU_OUTPUTS = path.join(OUTPUTS_ROOT, 'senzu');

// Ensure directories exist
if (!fs.existsSync(OUTPUT_TEMP_DIR)) {
  fs.mkdirSync(OUTPUT_TEMP_DIR, { recursive: true });
}
if (!fs.existsSync(SENZU_OUTPUTS)) {
  fs.mkdirSync(SENZU_OUTPUTS, { recursive: true });
}
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
// Ensure ComfyUI input dir + placeholder image for prompt enhancer workflow
const COMFY_INPUT = path.join(APP_ROOT, 'comfyui/input');
const PLACEHOLDER = path.join(COMFY_INPUT, 'senzu_placeholder.png');
if (!fs.existsSync(COMFY_INPUT)) {
  fs.mkdirSync(COMFY_INPUT, { recursive: true });
}
if (!fs.existsSync(PLACEHOLDER)) {
  // 1x1 white pixel PNG (valid, minimal)
  const minPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==', 'base64');
  fs.writeFileSync(PLACEHOLDER, minPng);
  console.log('[Init] Created placeholder image for prompt enhancer workflow');
}
const MULTER_TEMP = path.join(DATA_DIR, 'temp');
if (!fs.existsSync(MULTER_TEMP)) {
  fs.mkdirSync(MULTER_TEMP, { recursive: true });
}

// Multer storage
const upload = multer({ dest: MULTER_TEMP });

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Serve frontend static assets
app.use(express.static(path.resolve(__dirname, '../public')));

// Serve outputs static directory
app.use('/outputs', express.static(OUTPUTS_ROOT));
app.use('/temp-outputs', express.static(OUTPUT_TEMP_DIR));

// Clear temp outputs on start if setting enabled
const appSettings = settings.loadSettings();
if (appSettings.clear_temp_on_start) {
  const result = settings.clearTempOutputs(OUTPUT_TEMP_DIR);
  console.log(`[Init] Clear temp on start: cleared ${result.count || 0} files`);
}

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

// Downscale input image for SeedVR2 — gives the model more room to reconstruct detail
async function downscaleImage(imagePath, maxResolution) {
  if (maxResolution <= 0) return imagePath;
  try {
    const sharp = require('sharp');
    const meta = await sharp(imagePath).metadata();
    const longest = Math.max(meta.width, meta.height);
    console.log(`[Downscale] Input: ${meta.width}x${meta.height}, max: ${maxResolution}, longest: ${longest}`);
    if (longest <= maxResolution) return imagePath;
    const scale = maxResolution / longest;
    const newW = Math.round(meta.width * scale);
    const newH = Math.round(meta.height * scale);
    const tmpPath = `${imagePath}_ds.png`;
    await sharp(imagePath).resize(newW, newH, { kernel: 'lanczos3' }).toFile(tmpPath);
    console.log(`[Downscale] Resized: ${meta.width}x${meta.height} → ${newW}x${newH}`);
    return tmpPath;
  } catch (e) {
    console.error(`[Downscale] Failed: ${e.message}, returning original`);
    return imagePath;
  }
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

// Enhancer Prompt Presets
app.get('/api/enhancer-prompts', (req, res) => {
  res.json(enhancerPrompts.load());
});

app.post('/api/enhancer-prompts', (req, res) => {
  const { name, content } = req.body;
  if (!name || !content) return res.status(400).json({ error: "Missing name or content" });
  enhancerPrompts.save(name, content);
  res.json({ success: true });
});

app.delete('/api/enhancer-prompts/:name', (req, res) => {
  const ok = enhancerPrompts.delete(req.params.name);
  ok ? res.json({ success: true }) : res.status(404).json({ error: "Not found" });
});

// Generate Presets CRUD
app.get('/api/gen-presets', (req, res) => {
  res.json(genPresets.load());
});

app.post('/api/gen-presets', (req, res) => {
  const { name, data } = req.body;
  if (!name || !data) return res.status(400).json({ error: "Missing name or data" });
  genPresets.save(name, data);
  res.json({ success: true });
});

app.delete('/api/gen-presets/:name', (req, res) => {
  const ok = genPresets.delete(req.params.name);
  ok ? res.json({ success: true }) : res.status(404).json({ error: "Not found" });
});

// Generate Enhancer Prompt Presets
app.get('/api/gen-enhancer-prompts', (req, res) => {
  res.json(genEnhancerPrompts.load());
});

app.post('/api/gen-enhancer-prompts', (req, res) => {
  const { name, content } = req.body;
  if (!name || !content) return res.status(400).json({ error: "Missing name or content" });
  genEnhancerPrompts.save(name, content);
  res.json({ success: true });
});

app.delete('/api/gen-enhancer-prompts/:name', (req, res) => {
  const ok = genEnhancerPrompts.delete(req.params.name);
  ok ? res.json({ success: true }) : res.status(404).json({ error: "Not found" });
});

// Model Packs CRUD APIs
app.get('/api/model-packs', (req, res) => {
  const packs = modelPacks.loadModelPacks();
  delete packs._version;
  res.json(packs);
});

app.post('/api/model-packs', (req, res) => {
  const { name, data } = req.body;
  if (!name || !data) {
    return res.status(400).json({ error: "Missing name or data" });
  }
  const result = modelPacks.saveModelPack(name, data);
  if (result.success) {
    res.json({ success: true });
  } else {
    res.status(result.error === "Cannot overwrite a recommended model pack." ? 403 : 500)
       .json({ error: result.error });
  }
});

app.delete('/api/model-packs/:name', (req, res) => {
  const { name } = req.params;
  const result = modelPacks.deleteModelPack(name);
  if (result.success) {
    res.json({ success: true });
  } else {
    res.status(result.error === "Cannot delete a recommended model pack." ? 403 : 404)
       .json({ error: result.error });
  }
});

app.post('/api/model-packs/set-default', (req, res) => {
  const { name } = req.body;
  const s = settings.loadSettings();
  s.default_model_pack = name || '';
  const result = settings.saveSettings(s);
  if (result.success) {
    res.json({ success: true });
  } else {
    res.status(500).json({ error: result.error });
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

// Open a model folder
app.post('/api/models/open-folder', (req, res) => {
  const { type } = req.body;
  const dirMap = {
    diffusion_models: path.join(MODELS_ROOT, 'diffusion_models'),
    text_encoders: path.join(MODELS_ROOT, 'text_encoders'),
    vae: path.join(MODELS_ROOT, 'vae'),
    loras: path.join(MODELS_ROOT, 'loras')
  };
  const folderPath = dirMap[type];
  if (!folderPath) return res.status(400).json({ error: "Invalid model type" });
  if (!fs.existsSync(folderPath)) fs.mkdirSync(folderPath, { recursive: true });
  const result = settings.openFolder(folderPath);
  result.success ? res.json(result) : res.status(500).json(result);
});

// Check if ComfyUI is online API
app.get('/api/status', async (req, res) => {
  const isOnline = await comfy.checkComfyOnline();
  res.json({ comfyOnline: isOnline });
});

// Interrupt the currently executing ComfyUI prompt (Stop button)
app.post('/api/interrupt', async (req, res) => {
  try {
    const result = await comfy.interrupt();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to interrupt' });
  }
});

// System hardware stats
app.get('/api/system-stats', (req, res) => {
  res.json(sysStats.getStats());
});

// ComfyUI sampler/scheduler options
app.get('/api/comfyui-samplers', async (req, res) => {
  res.json(await comfy.fetchSamplers());
});

// HF Model Download APIs
app.get('/api/models/download-status', (req, res) => {
  res.json(currentDownload);
});

app.post('/api/models/download', (req, res) => {
  if (currentDownload.status === 'downloading') {
    return res.status(400).json({ error: "A download is already in progress" });
  }

  const { repo, filename, type, dest_filename } = req.body;
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

  const destName = dest_filename || filename;
  const destPath = path.join(destDir, destName);
  const url = `https://huggingface.co/${repo}/resolve/main/${filename}`;

  currentDownload = {
    filename: destName,
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

// Settings API
app.get('/api/settings', (req, res) => {
  const s = settings.loadSettings();
  if (!s.save_folder) {
    s.save_folder = SENZU_OUTPUTS;
  }
  res.json(s);
});

app.post('/api/settings', (req, res) => {
  const result = settings.saveSettings(req.body);
  if (result.success) {
    res.json({ success: true });
  } else {
    res.status(500).json({ error: result.error });
  }
});

app.post('/api/settings/open-outputs', (req, res) => {
  const { folder } = req.body;
  const folderPath = folder || SENZU_OUTPUTS;
  const result = settings.openFolder(folderPath);
  if (result.success) {
    res.json({ success: true });
  } else {
    res.status(500).json({ error: result.error });
  }
});

app.post('/api/outputs/save', (req, res) => {
  const { filename, save_folder, destName } = req.body;
  if (!filename || !save_folder) {
    return res.status(400).json({ error: "Missing filename or save_folder" });
  }
  const srcPath = path.join(OUTPUT_TEMP_DIR, filename);
  if (!fs.existsSync(srcPath)) {
    return res.status(404).json({ error: "Output file not found in temp" });
  }
  const resultName = destName || filename;
  const ok = settings.copyOutputToFolder(srcPath, save_folder, resultName);
  if (ok) {
    res.json({ success: true, message: `Saved ${resultName} to ${save_folder}` });
  } else {
    res.status(500).json({ error: "Failed to save output" });
  }
});

app.post('/api/outputs/clear-temp', (req, res) => {
  const result = settings.clearTempOutputs(OUTPUT_TEMP_DIR);
  res.json(result);
});

// Prompt Enhancement API (standalone)
app.post('/api/enhance-prompt', upload.single('image'), async (req, res) => {
  try {
    const { prompt, parameters: rawParams } = req.body;
    if (!prompt || !prompt.trim()) {
      return res.status(400).json({ error: "Prompt is required" });
    }

    let parsedParams = {};
    if (rawParams) {
      try {
        parsedParams = typeof rawParams === 'string' ? JSON.parse(rawParams) : rawParams;
      } catch (_) {}
    }

    const workflowPath = path.join(WORKFLOWS_DIR, 'senzu_prompt_enhancer.json');
    const enhancerParams = {
      user_prompt: prompt,
      system_prompt: parsedParams.system_prompt || '',
      enable_enhancer: true,
      use_image_ref: parsedParams.use_image_ref === true,
      llm_clip_name: parsedParams.llm_clip_name || 'qwen3vl_4b_fp8_scaled.safetensors',
      max_length: parseInt(parsedParams.max_length, 10) || 768,
      temperature: parseFloat(parsedParams.temperature) || 0.7
    };

    if (req.file && parsedParams.use_image_ref) {
      enhancerParams.image = req.file.path;
    }

    console.log(`[EnhancePrompt] Running standalone enhancer for: "${prompt.substring(0, 80)}..."`);
    const result = await comfy.runWorkflow(workflowPath, 'prompt_enhancer', enhancerParams);

    // Clean up uploaded image
    if (req.file && fs.existsSync(req.file.path)) {
      try { fs.unlinkSync(req.file.path); } catch (_) {}
    }

    res.json({
      success: true,
      enhanced_prompt: result.text || prompt
    });
  } catch (err) {
    // Clean up uploaded image on error
    if (req.file && fs.existsSync(req.file.path)) {
      try { fs.unlinkSync(req.file.path); } catch (_) {}
    }
    console.error("Prompt enhancement error:", err);
    res.status(500).json({ error: err.message || "Enhancement failed" });
  }
});

// Image Generation API (Krea2 T2I / Img2Img / Identity Edit)
app.post('/api/generate', upload.fields([{ name: 'image', maxCount: 1 }, { name: 'image_b', maxCount: 1 }]), async (req, res) => {
  const uploadedFiles = [
    ...(req.files?.image || []),
    ...(req.files?.image_b || [])
  ];
  const cleanupUploads = () => {
    for (const f of uploadedFiles) {
      if (fs.existsSync(f.path)) {
        try { fs.unlinkSync(f.path); } catch (_) {}
      }
    }
  };
  try {
    const isOnline = await comfy.checkComfyOnline();
    if (!isOnline) {
      cleanupUploads();
      return res.status(503).json({ error: "ComfyUI backend is offline. Please launch ComfyUI first." });
    }

    const { parameters: rawParams } = req.body;
    let parsedParams = {};
    if (rawParams) {
      try {
        parsedParams = typeof rawParams === 'string' ? JSON.parse(rawParams) : rawParams;
      } catch (err) {
        cleanupUploads();
        return res.status(400).json({ error: "Invalid parameters format" });
      }
    }

    const randomizeSeed = parsedParams.randomize_seed !== false;
    const seedVal = randomizeSeed ? Math.floor(Math.random() * 1000000000) : (parseInt(parsedParams.seed, 10) || 0);

    const width = parseInt(parsedParams.width, 10) || 1024;
    const height = parseInt(parsedParams.height, 10) || 1024;
    const useImgInput = parsedParams.use_image_input === true;
    const useKrea2Edit = useImgInput && parsedParams.use_krea2_edit === true;
    const inputImage = req.files?.image?.[0];
    const inputImageB = req.files?.image_b?.[0];

    // Resolve {a|b|c} dynamic prompts here — ComfyUI only does this in its own
    // web UI, so via the API the raw braces would otherwise reach the encoder.
    const resolvedPrompt = processDynamicPrompt(parsedParams.prompt || '', seedVal);

    const loraParams = {
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

    // On non-ROCm installs the INT8 custom node isn't cloned; ComfyUI rejects
    // the workflow if it references the missing class. Strip the three INT8
    // nodes (85/86/87) and rewire the LoRA chain straight to the standard
    // UNet loader so the workflow validates correctly everywhere.
    const int8Available = fs.existsSync(path.resolve(__dirname, '../comfyui/custom_nodes/ComfyUI-INT8-Fast-ROCM'));

    let result;
    if (useKrea2Edit) {
      // Krea2 Identity Edit: dedicated workflow. The identity-edit LoRA is baked
      // into the workflow, the grounded encoders replace CLIPTextEncode, and the
      // INT8 loader is not part of this graph (it doesn't work with the
      // Krea2EditModelPatch), so an enabled INT8 toggle is silently bypassed.
      if (!inputImage) {
        cleanupUploads();
        return res.status(400).json({ error: "Krea2 Edit requires an input image" });
      }
      const workflowPath = path.join(WORKFLOWS_DIR, 'senzu_krea2_identity_edit_3.json');
      // Resolve the identity-edit LoRA: prefer the user-selected LoRA if it
      // exists. Otherwise auto-select from candidates: v1.2 full > v1.2 lite >
      // v1.1 full > v1.1 lite, checking both senzu/ subfolder and loras root.
      const identityCandidates = [
        'senzu/krea2_identity_edit_v1_2.safetensors',
        'senzu/krea2_identity_edit_v1_2_r64.safetensors',
        'krea2_identity_edit_v1_2.safetensors',
        'krea2_identity_edit_v1_2_r64.safetensors',
        'senzu/krea2_identity_edit_v1_1.safetensors',
        'krea2_identity_edit_v1_1.safetensors',
        'senzu/krea2_identity_edit_v1_1_r64.safetensors',
        'krea2_identity_edit_v1_1_r64.safetensors'
      ];
      let identityLora = '';
      if (parsedParams.identity_lora_name && fs.existsSync(path.join(MODELS_ROOT, 'loras', parsedParams.identity_lora_name))) {
        identityLora = parsedParams.identity_lora_name;
      } else {
        identityLora = identityCandidates.find(rel => fs.existsSync(path.join(MODELS_ROOT, 'loras', rel))) || '';
      }
      if (!identityLora) {
        cleanupUploads();
        return res.status(400).json({ error: "Identity Edit LoRA not found. Download the \"Krea2 Identity Edit\" pack from the Models tab." });
      }
      // grounding_px: trained range 512-1536, node steps by 64
      const groundingRaw = parseInt(parsedParams.grounding_px, 10) || 768;
      const groundingPx = Math.min(1536, Math.max(512, Math.round(groundingRaw / 64) * 64));
      const identityRaw = parseFloat(parsedParams.identity_lora_strength);
      const identityStrength = Number.isFinite(identityRaw) ? Math.min(1.2, Math.max(0, identityRaw)) : 1.0;
      const ASPECT_RATIOS = ['1:1 (Square)', '2:3 (Portrait Photo)', '3:2 (Photo)', '3:4 (Portrait Standard)', '4:3 (Standard)', '9:16 (Portrait Widescreen)', '16:9 (Widescreen)', '21:9 (Ultrawide)'];
      const aspectRatio = ASPECT_RATIOS.includes(parsedParams.aspect_ratio) ? parsedParams.aspect_ratio : '1:1 (Square)';
      const multipleRaw = parseInt(parsedParams.resolution_multiple, 10);
      const resolutionMultiple = [8, 16, 32, 64].includes(multipleRaw) ? multipleRaw : 8;

      const editParams = {
        image: inputImage.path,
        unet_name: parsedParams.unet_name || 'krea2_turbo_fp8_scaled.safetensors',
        vae_name: parsedParams.vae_name || 'qwen_image_vae.safetensors',
        clip_name: parsedParams.clip_name || 'qwen3vl_4b_fp8_scaled.safetensors',
        prompt: resolvedPrompt,
        grounding_px: groundingPx,
        identity_lora_name: identityLora,
        identity_lora_strength: identityStrength,
        scale_to_ref: parsedParams.scale_to_ref !== false,
        aspect_ratio: aspectRatio,
        resolution_multiple: resolutionMultiple,
        megapixels: parseFloat(parsedParams.megapixels) || 1.0,
        ref_boost: Number.isFinite(parseFloat(parsedParams.ref_boost)) ? parseFloat(parsedParams.ref_boost) : 4,
        fit_mode: (parsedParams.fit_mode === 'crop (legacy)') ? 'crop (legacy)' : 'fit',
        seed: seedVal,
        steps: parseInt(parsedParams.steps, 10) || 8,
        cfg: parseFloat(parsedParams.cfg) || 1.0,
        sampler_name: parsedParams.sampler_name || 'euler',
        scheduler: parsedParams.scheduler || 'beta',
        ...loraParams
      };
      if (inputImageB) {
        editParams.image_b = inputImageB.path;
      }

      console.log(`[Generate] Running Krea2 Identity Edit${inputImageB ? ' (2 refs)' : ''}: "${resolvedPrompt.substring(0, 80)}..."`);
      result = await comfy.runWorkflow(workflowPath, 'krea2_edit', editParams);
    } else {
      const workflowPath = path.join(WORKFLOWS_DIR, 'senzu_gen1.json');

      const genParams = {
        width,
        height,
        unet_name: parsedParams.unet_name || 'krea2_turbo_fp8_scaled.safetensors',
        use_int8_loader: parsedParams.use_int8_loader === true,
        int8_model_type: parsedParams.int8_model_type || 'krea2',
        int8_enable_convrot: parsedParams.int8_enable_convrot !== false,
        vae_name: parsedParams.vae_name || 'qwen_image_vae.safetensors',
        clip_name: parsedParams.clip_name || 'qwen3vl_4b_fp8_scaled.safetensors',
        seed: seedVal,
        steps: parseInt(parsedParams.steps, 10) || 8,
        cfg: parseFloat(parsedParams.cfg) || 1.0,
        denoise: useImgInput ? (parseFloat(parsedParams.denoise) || 0.6) : 1.0,
        sampler_name: parsedParams.sampler_name || 'euler',
        scheduler: parsedParams.scheduler || 'beta',
        prompt: resolvedPrompt,
        use_image_input: useImgInput,
        megapixels: parseFloat(parsedParams.megapixels) || 1.0,
        ...loraParams
      };

      if (useImgInput && inputImage) {
        genParams.image = inputImage.path;
      }

      const modeLabel = useImgInput ? 'Img2Img' : 'T2I';
      console.log(`[Generate] Running Krea2 ${modeLabel}: "${resolvedPrompt.substring(0, 80)}..."`);
      result = await comfy.runWorkflow(workflowPath, 'gen1', genParams, undefined, !int8Available);
    }

    // Clean up uploaded images
    cleanupUploads();

    const timestamp = Date.now();
    const outPath = path.join(OUTPUT_TEMP_DIR, `gen_${timestamp}.png`);
    await comfy.downloadComfyImage(result.filename, result.subfolder, result.type, outPath);
    console.log(`[Generate] Complete. Saved to ${outPath}`);

    res.json({
      success: true,
      output: `/temp-outputs/${path.basename(outPath)}`
    });

  } catch (err) {
    cleanupUploads();
    console.error("Generation error:", err);
    res.status(500).json({ error: err.message || "An unexpected error occurred during generation." });
  }
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

    // Parse parent metadata from the input image's ComfyUI workflow JSON
    // (embedded in the PNG prompt text chunk). Creative fields (prompt, seed,
    // model, loras) are carried forward through the pipeline so the gallery
    // always traces back to the original generation parameters.
    let parentMeta = '';
    let inheritedProcessParams = '';
    try {
      const { parse: exifrParse } = require('exifr');
      const inputExif = await exifrParse(inputImagePath, true);
      if (inputExif?.prompt && typeof inputExif.prompt === 'string') {
        const parentWorkflow = JSON.parse(inputExif.prompt);
        const parentCreative = new (require('./crawler/comfyui'))().parse(parentWorkflow);
        if (parentCreative) {
          const pm = {
            prompt: parentCreative.prompt || null,
            seed: parentCreative.seed || null,
            model_name: parentCreative.model_name || null,
            loras: parentCreative.loras || null,
            negative_prompt: parentCreative.negative_prompt || null
          };
          if (parentCreative.process_params) {
            pm._process_params = parentCreative.process_params;
          }
          parentMeta = JSON.stringify(pm);
        }
      }
    } catch (_) {
      // If exifr fails or the input isn't a ComfyUI output, parentMeta stays ''
    }
    
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
        lora6_strength: parsedParams.lora6_enabled ? parseFloat(parsedParams.lora6_strength) : 0,
        parent_metadata: parentMeta
      };

      console.log(`[Enhance] Running Edit Step with workflow ${editWorkflowName}...`);
      editResult = await comfy.runWorkflow(editWorkflowPath, 'edit', editParams);
      
      // Save output locally
      editOutPath = path.join(OUTPUT_TEMP_DIR, `edit_${timestamp}.png`);
      await comfy.downloadComfyImage(editResult.filename, editResult.subfolder, editResult.type, editOutPath);
      console.log(`[Enhance] Edit Step complete. Saved to ${editOutPath}`);

      // Pre-seed gallery record with stage tag so the image is tagged
      // before the watcher indexes it.
      try {
        const editFp = await galleryDb.computeFingerprint(editOutPath, fs.statSync(editOutPath));
        galleryDb.addTags([editFp], ['stage:edit']);
      } catch (_) {}
    }

    // Step 2: Run Upscale if mode is full or upscale
    let upscaleResult = null;
    let upscaleOutPath = '';
    
    if (mode === 'full' || mode === 'upscale') {
      const upscaleWorkflowPath = path.join(WORKFLOWS_DIR, 'senzu_upscale.json');
      
      const seedVal = randomizeSeed ? Math.floor(Math.random() * 1000000000) : (parseInt(parsedParams.seed, 10) || 42);

      // Auto-detect device for SeedVR2 (no built-in detection)
      const isMac = process.platform === 'darwin';
      const device = parsedParams.device && parsedParams.device !== 'cuda:0'
        ? parsedParams.device
        : (isMac ? 'mps' : 'cuda:0');
      const attention = parsedParams.attention_mode && parsedParams.attention_mode !== 'flash_attn_2'
        ? parsedParams.attention_mode
        : (isMac ? 'sdpa' : 'flash_attn_2');
      const offload = parsedParams.offload_device && parsedParams.offload_device !== 'cpu'
        ? parsedParams.offload_device
        : (isMac ? 'none' : 'cpu');

      // Downscale input if needed (gives SeedVR2 more room to work)
      let upscaleInputImage = mode === 'full' ? editOutPath : inputImagePath;
      // Parse parent metadata from the ORIGINAL source (before any downscaling
      // strips the PNG ComfyUI chunks) so the chain isn't broken.
      // For a full run, override the top-level parse — the edit PNG has the
      // same gen creative fields in its Parent Metadata node PLUS the
      // edit-stage process_params.
      if (mode === 'full' && editOutPath) {
        try {
          const { parse: exifrParse } = require('exifr');
          const editExif = await exifrParse(editOutPath, true);
          if (editExif?.prompt && typeof editExif.prompt === 'string') {
            const parentWorkflow = JSON.parse(editExif.prompt);
            const parentCreative = new (require('./crawler/comfyui'))().parse(parentWorkflow);
            if (parentCreative) {
              const pm = {
                prompt: parentCreative.prompt || null,
                seed: parentCreative.seed || null,
                model_name: parentCreative.model_name || null,
                loras: parentCreative.loras || null,
                negative_prompt: parentCreative.negative_prompt || null
              };
              if (parentCreative.process_params) {
                pm._process_params = parentCreative.process_params;
              }
              parentMeta = JSON.stringify(pm);
            }
          }
        } catch (_) {}
      }
      const maxInputRes = parseInt(parsedParams.max_input_resolution, 10) || 0;
      if (maxInputRes > 0) {
        upscaleInputImage = await downscaleImage(upscaleInputImage, maxInputRes);
      }

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
        offload_device: offload,
        
        device,
        encode_tiled: parsedParams.encode_tiled !== false,
        encode_tile_size: parseInt(parsedParams.encode_tile_size, 10) || 1024,
        encode_tile_overlap: parseInt(parsedParams.encode_tile_overlap, 10) || 128,
        decode_tiled: parsedParams.decode_tiled !== false,
        decode_tile_size: parseInt(parsedParams.decode_tile_size, 10) || 1024,
        decode_tile_overlap: parseInt(parsedParams.decode_tile_overlap, 10) || 128,
        
        dit_model: parsedParams.dit_model || 'seedvr2_ema_7b_fp8_e4m3fn_mixed_block35_fp16.safetensors',
        dit_device: device,
        blocks_to_swap: parseInt(parsedParams.blocks_to_swap, 10) || 36,
        attention_mode: attention,
        parent_metadata: parentMeta
      };

      console.log(`[Enhance] Running Upscale Step with workflow senzu_upscale.json...`);
      upscaleResult = await comfy.runWorkflow(upscaleWorkflowPath, 'upscale', upscaleParams);
      
      // Save output locally
      upscaleOutPath = path.join(OUTPUT_TEMP_DIR, `upscale_${timestamp}.png`);
      await comfy.downloadComfyImage(upscaleResult.filename, upscaleResult.subfolder, upscaleResult.type, upscaleOutPath);
      console.log(`[Enhance] Upscale Step complete. Saved to ${upscaleOutPath}`);

      try {
        const upscaleFp = await galleryDb.computeFingerprint(upscaleOutPath, fs.statSync(upscaleOutPath));
        galleryDb.addTags([upscaleFp], ['stage:upscale']);
      } catch (_) {}
    }

    // Clean up local temp uploaded file
    if (req.file && fs.existsSync(req.file.path)) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (err) {
        // Ignored
      }
    }

    // Autosave outputs to user's save folder if enabled
    if (parsedParams.autosave && parsedParams.save_folder) {
      const stem = (parsedParams.input_filename || 'senzu').replace(/\.[^.]+$/, '');
      const ts = Date.now().toString(36);
      if (editOutPath) settings.copyOutputToFolder(editOutPath, parsedParams.save_folder, `${stem}_senzu_ed_${ts}.png`);
      if (upscaleOutPath) {
        const upsSuffix = mode === 'full' ? 'ed_ups' : 'ups';
        settings.copyOutputToFolder(upscaleOutPath, parsedParams.save_folder, `${stem}_senzu_${upsSuffix}_${ts}.png`);
      }
    }

    // Return the appropriate response depending on mode
    const responsePayload = { success: true, mode };
    
    if (mode === 'edit') {
      responsePayload.output = `/temp-outputs/${path.basename(editOutPath)}`;
      responsePayload.editOutput = responsePayload.output;
    } else if (mode === 'upscale') {
      responsePayload.output = `/temp-outputs/${path.basename(upscaleOutPath)}`;
      responsePayload.upscaleOutput = responsePayload.output;
    } else if (mode === 'full') {
      responsePayload.output = `/temp-outputs/${path.basename(upscaleOutPath)}`;
      responsePayload.editOutput = `/temp-outputs/${path.basename(editOutPath)}`;
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

// ============================================================
// Gallery: SQLite index + metadata crawler + file watcher + Socket.IO
// ============================================================
const GALLERY_DB_PATH = path.join(DATA_DIR, 'senzu.db');
const GALLERY_TRASH_DIR = path.join(DATA_DIR, 'gallery-trash');
const GALLERY_THUMB_DIR = path.join(DATA_DIR, 'thumbnails');
if (!fs.existsSync(GALLERY_TRASH_DIR)) {
  fs.mkdirSync(GALLERY_TRASH_DIR, { recursive: true });
}
if (!fs.existsSync(GALLERY_THUMB_DIR)) {
  fs.mkdirSync(GALLERY_THUMB_DIR, { recursive: true });
}

const galleryDb = new GalleryDatabase(GALLERY_DB_PATH);
const galleryParser = new Parser();

// Bump PARSER_VERSION whenever metadata extraction improves — existing rows
// are then re-parsed once on startup (fingerprint unchanged, so tags survive).
const PARSER_VERSION = '3';

// Connected folders: default to the Senzu outputs folder (protected — cannot
// be disconnected from the UI). Users can connect additional folders anywhere.
galleryDb.addFolder(SENZU_OUTPUTS, true);
const GALLERY_PROTECTED_FOLDERS = [SENZU_OUTPUTS];

// HTTP server + Socket.IO (shares the Express app)
const server = http.createServer(app);
const io = require('socket.io')(server, { cors: { origin: '*' } });
io.on('connection', (socket) => {
  socket.emit('gallery-count', { count: galleryDb.getCount() });
});

// Scan/watch manager — owns the live watcher and the connected-folder set.
// For now we only live-watch the Senzu output dir (the in-app save folder, or
// the default app/outputs/senzu). Other connected folders stay indexed but are
// not watched, so a huge external gallery folder can't crash the watcher.
const galleryWatchDir = (appSettings.save_folder && appSettings.save_folder.trim())
  ? path.resolve(appSettings.save_folder)
  : SENZU_OUTPUTS;
const galleryManager = scanner.createManager({
  db: galleryDb,
  parser: galleryParser,
  io,
  staticRoot: OUTPUTS_ROOT,
  watchPaths: [SENZU_OUTPUTS, galleryWatchDir]
});

// Full re-index: re-parse metadata for every indexed file. Used on the parser
// version bump and by the "Re-index Images" button.
async function reindexGallery() {
  await galleryManager.reindexAll();
  galleryDb.setSetting('parser_version', PARSER_VERSION);
  return galleryDb.getCount();
}

// Native OS folder picker (Windows dialog / macOS osascript / Linux zenity).
// Returns { path } on selection, { cancelled } if dismissed, or
// { unavailable } if no native picker exists (client offers a path input).
function pickFolder() {
  return new Promise((resolve) => {
    const { execFile } = require('child_process');
    const platform = process.platform;
    let cmd, args;
    if (platform === 'win32') {
      const ps = "Add-Type -AssemblyName System.Windows.Forms | Out-Null; " +
        "$d = New-Object System.Windows.Forms.FolderBrowserDialog; " +
        "$d.Description = 'Select a folder to connect to the Senzu gallery'; " +
        "$d.ShowNewFolderButton = $false; " +
        "$top = New-Object System.Windows.Forms.Form; $top.TopMost = $true; " +
        "if ($d.ShowDialog($top) -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($d.SelectedPath) }";
      cmd = 'powershell';
      args = ['-STA', '-NoProfile', '-NonInteractive', '-Command', ps];
    } else if (platform === 'darwin') {
      cmd = 'osascript';
      args = ['-e', 'POSIX path of (choose folder with prompt "Select a folder to connect to the Senzu gallery")'];
    } else {
      cmd = 'zenity';
      args = ['--file-selection', '--directory', '--title=Select a folder to connect to the Senzu gallery'];
    }
    execFile(cmd, args, { windowsHide: true, timeout: 180000, maxBuffer: 1024 * 64 }, (err, stdout) => {
      const picked = (stdout || '').trim();
      if (picked) return resolve({ path: picked });
      if (err && err.code === 'ENOENT') return resolve({ unavailable: true });
      resolve({ cancelled: true });
    });
  });
}

app.use('/api/gallery', createGalleryRouter({
  db: galleryDb,
  outputsRoot: OUTPUTS_ROOT,
  trashDir: GALLERY_TRASH_DIR,
  thumbDir: GALLERY_THUMB_DIR,
  reindex: reindexGallery,
  openFolder: settings.openFolder,
  manager: galleryManager,
  pickFolder,
  protectedFolders: GALLERY_PROTECTED_FOLDERS
}));

server.listen(PORT, '127.0.0.1', () => {
  console.log(`=================================================`);
  console.log(`Senzu Backend is running on port ${PORT}`);
  console.log(`Access at http://localhost:${PORT}`);
  console.log(`comfyui endpoint: ${comfy.COMFY_URL}`);
  console.log(`=================================================`);

  // Kick off the gallery scan + watcher after the server is listening.
  const forceReindex = galleryDb.getSetting('parser_version') !== PARSER_VERSION;
  galleryManager.start({ force: forceReindex })
    .then(() => galleryDb.setSetting('parser_version', PARSER_VERSION))
    .catch(err => console.error('[Gallery] Initial scan failed:', err.message));
});
