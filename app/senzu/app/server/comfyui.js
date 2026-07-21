const path = require('path');
const fs = require('fs');
const http = require('http');
const FormData = require('form-data');
const workflowMap = require('./workflowMap');

const COMFY_URL = 'http://127.0.0.1:8188';

// HTTP JSON POST helper
function postJSON(url, data) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const bodyStr = JSON.stringify(data);
    const options = {
      method: 'POST',
      host: parsedUrl.hostname,
      port: parsedUrl.port,
      path: parsedUrl.pathname,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr)
      }
    };
    
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(new Error("Failed to parse POST response: " + e.message));
          }
        } else {
          reject(new Error(`POST failed with status ${res.statusCode}: ${body}`));
        }
      });
    });
    
    req.on('error', (err) => reject(err));
    req.write(bodyStr);
    req.end();
  });
}

// HTTP JSON GET helper
function getJSON(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(new Error("Failed to parse GET response: " + e.message));
          }
        } else {
          reject(new Error(`GET failed with status ${res.statusCode}`));
        }
      });
    }).on('error', reject);
  });
}

// Upload local image to ComfyUI
function uploadImage(filePath) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(filePath)) {
      return reject(new Error(`File not found: ${filePath}`));
    }
    
    const form = new FormData();
    form.append('image', fs.createReadStream(filePath));
    
    const parsedUrl = new URL(COMFY_URL);
    const options = {
      method: 'POST',
      host: parsedUrl.hostname,
      port: parsedUrl.port,
      path: '/upload/image',
      headers: form.getHeaders()
    };
    
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(new Error("Failed to parse upload response: " + e.message));
          }
        } else {
          reject(new Error(`Upload failed with status code ${res.statusCode}: ${body}`));
        }
      });
    });
    
    req.on('error', (err) => reject(err));
    form.pipe(req);
  });
}

// Check if ComfyUI is online
function checkComfyOnline() {
  return new Promise((resolve) => {
    const parsedUrl = new URL(COMFY_URL);
    const req = http.request({
      method: 'GET',
      host: parsedUrl.hostname,
      port: parsedUrl.port,
      path: '/system_stats',
      timeout: 1500
    }, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}

function normalizeWorkflowValue(field, value) {
  if (typeof value !== 'string') {
    return value;
  }

  if (field === 'lora_name' && process.platform === 'win32') {
    return value.replace(/\//g, '\\');
  }

  return value;
}

// Download image from ComfyUI view endpoint
function downloadComfyImage(filename, subfolder, type, destPath) {
  return new Promise((resolve, reject) => {
    const query = `filename=${encodeURIComponent(filename)}&subfolder=${encodeURIComponent(subfolder || '')}&type=${encodeURIComponent(type || 'output')}`;
    const url = `${COMFY_URL}/view?${query}`;
    
    const dir = path.dirname(destPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    const file = fs.createWriteStream(destPath);
    http.get(url, (res) => {
      if (res.statusCode !== 200) {
        file.close();
        fs.unlinkSync(destPath);
        return reject(new Error(`Failed to download image: ${res.statusCode}`));
      }
      res.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve(destPath);
      });
    }).on('error', (err) => {
      file.close();
      if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
      reject(err);
    });
  });
}

// Inject params into ComfyUI workflow JSON
async function injectParams(workflowJson, mode, params) {
  const map = workflowMap[mode];
  if (!map) {
    throw new Error(`Unknown workflow mode: ${mode}`);
  }
  
  const patched = JSON.parse(JSON.stringify(workflowJson)); // deep copy
  
  for (const [key, val] of Object.entries(params)) {
    const entry = map[key];
    if (!entry) continue;

    // A param can target multiple nodes (e.g. one model name feeding two loaders).
    const targets = Array.isArray(entry) ? entry : [entry];
    for (const { node, field, upload } of targets) {
      if (!patched[node]) continue;
      if (!patched[node].inputs) patched[node].inputs = {};

      if (upload && val) {
        // If it is a file path, upload it first
        if (fs.existsSync(val)) {
          console.log(`Uploading input image ${key}: ${val}...`);
          const uploadResult = await uploadImage(val);
          patched[node].inputs[field] = uploadResult.name;
          console.log(`Uploaded successfully as ${uploadResult.name}`);
        } else {
          // Already uploaded filename
          patched[node].inputs[field] = val;
        }
      } else {
        patched[node].inputs[field] = normalizeWorkflowValue(field, val);
      }
    }
  }
  
  return patched;
}

// Poll history until complete
function pollHistory(promptId, intervalMs = 1000) {
  return new Promise((resolve, reject) => {
    const url = `${COMFY_URL}/history/${promptId}`;
    const timer = setInterval(async () => {
      try {
        const history = await getJSON(url);
        if (history && history[promptId]) {
          clearInterval(timer);
          resolve(history[promptId]);
        }
      } catch (err) {
        // Suppress transient GET errors while restarting/polling
      }
    }, intervalMs);
  });
}

// The INT8-Fast-ROCM custom node may not be installed (NVIDIA / macOS / no-AMD
// install). ComfyUI validates every node in the prompt, even ones behind a switch,
// so leaving nodes 85 (OTUNetLoaderW8A8), 86 (PrimitiveBoolean) and 87
// (ComfySwitchNode) in the graph causes queue-time rejection. Strip them and
// rewire the LoRA chain (node 64) straight to the standard loader (node 54).
function stripInt8Nodes(workflow) {
  if (!workflow['85'] && !workflow['87']) return workflow; // not a gen1 workflow / already stripped
  delete workflow['85'];
  delete workflow['86'];
  delete workflow['87'];
  // Re-route: LoRA 1 (node 64) model input was "87" (the removed switch) -> 54 (standard loader)
  if (workflow['64']?.inputs?.model) {
    workflow['64'].inputs.model = ['54', 0];
  }
  return workflow;
}

// The krea2_edit workflow ships with an optional second-reference branch
// (nodes 23/24/25 -> image_b / source_latent_b / source_image_b). Both
// Krea2Edit nodes treat the b-inputs as optional, so when the user supplies no
// second image we remove the branch and the b-input links entirely rather than
// feeding a placeholder image into the conditioning.
function stripKrea2RefB(workflow) {
  delete workflow['23'];
  delete workflow['24'];
  delete workflow['25'];
  for (const nodeId of ['7', '9']) {
    if (workflow[nodeId]?.inputs) delete workflow[nodeId].inputs.image_b;
  }
  // v2 Krea2EditModelPatch (node 10) and v3 (node 34)
  for (const nodeId of ['10', '34']) {
    if (workflow[nodeId]?.inputs) {
      delete workflow[nodeId].inputs.source_latent_b;
      delete workflow[nodeId].inputs.source_image_b;
    }
  }
  return workflow;
}

// Main execution helper
async function runWorkflow(workflowPath, mode, params, progressCallback, stripInt8 = false) {
  if (!fs.existsSync(workflowPath)) {
    throw new Error(`Workflow file not found: ${workflowPath}`);
  }
  
  const rawWorkflow = JSON.parse(fs.readFileSync(workflowPath, 'utf-8'));
  if (stripInt8) stripInt8Nodes(rawWorkflow);
  if (mode === 'krea2_edit' && !params.image_b) stripKrea2RefB(rawWorkflow);
  
  if (progressCallback) progressCallback("Preparing workflow...");
  const patchedWorkflow = await injectParams(rawWorkflow, mode, params);
  
  if (progressCallback) progressCallback("Queueing prompt...");
  const queueResult = await postJSON(`${COMFY_URL}/prompt`, {
    prompt: patchedWorkflow,
    client_id: 'senzu'
  });
  
  if (queueResult.node_errors && Object.keys(queueResult.node_errors).length > 0) {
    throw new Error(`ComfyUI node validation errors: ${JSON.stringify(queueResult.node_errors)}`);
  }
  
  const promptId = queueResult.prompt_id;
  if (!promptId) {
    throw new Error("Failed to queue prompt: No prompt ID returned");
  }
  
  if (progressCallback) progressCallback("Processing in ComfyUI...");
  const historyResult = await pollHistory(promptId);
  
  if (historyResult.status && historyResult.status.status === "error") {
    const messages = historyResult.status.messages || [];
    throw new Error(`Execution error: ${messages.map(m => m[1] || m[0]).join(', ')}`);
  }
  
  // Find output image in history
  let imageOutput = null;
  const targetNodeId = mode === 'edit' ? '1' : (mode === 'krea2_edit' ? '33' : '23');
  
  if (historyResult.outputs && historyResult.outputs[targetNodeId] && historyResult.outputs[targetNodeId].images) {
    imageOutput = historyResult.outputs[targetNodeId].images[0];
  } else if (historyResult.outputs) {
    // Fallback: search for any node that has an output image
    for (const [nodeId, out] of Object.entries(historyResult.outputs)) {
      if (out.images && out.images.length > 0) {
        imageOutput = out.images[0];
        break;
      }
    }
  }
  
  if (!imageOutput) {
    // Check for text-only output first (e.g. prompt enhancer workflow)
    if (historyResult.outputs) {
      for (const [nodeId, out] of Object.entries(historyResult.outputs)) {
        if (out.text && out.text.length > 0) {
          return {
            filename: null,
            subfolder: null,
            type: null,
            prompt_id: promptId,
            text: out.text[0]
          };
        }
      }
    }
    throw new Error("No output image found in ComfyUI execution history.");
  }

  // Extract text outputs (e.g. enhanced prompts from TextGenerate/PreviewAny nodes)
  let textOutput = null;
  if (historyResult.outputs) {
    for (const [nodeId, out] of Object.entries(historyResult.outputs)) {
      if (out.text && out.text.length > 0) {
        textOutput = out.text[0];
        break;
      }
    }
  }
  
  return {
    filename: imageOutput.filename,
    subfolder: imageOutput.subfolder,
    type: imageOutput.type,
    prompt_id: promptId,
    text: textOutput
  };
}

async function fetchSamplers() {
  const FALLBACK_SAMPLERS = ["euler", "euler_ancestral", "dpmpp_2m", "dpmpp_2m_sde", "dpmpp_3m_sde", "res_multistep"];
  const FALLBACK_SCHEDULERS = ["simple", "normal", "karras", "exponential", "sgm_uniform", "beta"];
  try {
    const data = await getJSON(`${COMFY_URL}/object_info/KSampler`);
    const required = data?.KSampler?.input?.required || {};
    const samplers = required.sampler_name?.[0] || FALLBACK_SAMPLERS;
    const schedulers = required.scheduler?.[0] || FALLBACK_SCHEDULERS;
    return { samplers, schedulers };
  } catch (_) {
    return { samplers: FALLBACK_SAMPLERS, schedulers: FALLBACK_SCHEDULERS };
  }
}

// Interrupt the prompt ComfyUI is currently executing. /interrupt returns an
// empty 200 body, so we resolve on status rather than parsing JSON.
function interrupt() {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(COMFY_URL);
    const req = http.request({
      method: 'POST',
      host: parsedUrl.hostname,
      port: parsedUrl.port,
      path: '/interrupt',
      headers: { 'Content-Type': 'application/json', 'Content-Length': 2 }
    }, (res) => {
      res.on('data', () => {});
      res.on('end', () => resolve({ success: res.statusCode >= 200 && res.statusCode < 300 }));
    });
    req.on('error', reject);
    req.write('{}');
    req.end();
  });
}

module.exports = {
  checkComfyOnline,
  uploadImage,
  downloadComfyImage,
  runWorkflow,
  fetchSamplers,
  stripInt8Nodes,
  interrupt,
  COMFY_URL
};
