// Senzu metadata parser — multi-source ComfyUI metadata extraction.
// Reads PNG text chunks with exifr and tries the following sources in order:
//   1. `prompt` — standard ComfyUI SaveImage / PreviewImage chunk
//   2. `workflow` — alternate chunk name (Krea2CivitaiSaveImage, etc.)
//   3. `extraMetadata` — structured JSON with prompt/model/loras/seed
//      (written by Krea2CivitaiSaveImage, rgthree Save Image, and others)
//   4. `parameters` — A1111-style text fallback
// Each source is tried independently; the first that yields a prompt wins.
// The result always uses the canonical field names (prompt, seed, model_name,
// loras as a JSON string) so the gallery query/filter system works uniformly.

const exifr = require('exifr');
const ComfyUIParser = require('./comfyui');

class Parser {
  constructor() {
    this.comfyParser = new ComfyUIParser();
  }

  // Try to parse a ComfyUI workflow JSON from a string field.
  // Returns creative fields or null.
  tryWorkflowParse(jsonStr) {
    try {
      const workflow = JSON.parse(jsonStr);
      if (workflow && typeof workflow === 'object') {
        const keys = Object.keys(workflow);
        if (keys.length > 0 && workflow[keys[0]]?.class_type) {
          const comfyData = this.comfyParser.parse(workflow);
          if (comfyData?.prompt) {
            return comfyData;
          }
        }
      }
    } catch (_) {}
    return null;
  }

  // Parse the structured `extraMetadata` JSON chunk.
  // Returns creative fields or null.
  tryExtraMetaParse(jsonStr) {
    try {
      const meta = JSON.parse(jsonStr);
      if (!meta?.prompt) return null;
      const result = {
        prompt: meta.prompt,
        negative_prompt: meta.negativePrompt || meta.negative_prompt || null,
        seed: meta.seed != null ? meta.seed : null,
        steps: meta.steps != null ? meta.steps : null,
        cfg_scale: meta.cfgScale != null ? meta.cfgScale : (meta.cfg_scale != null ? meta.cfg_scale : null),
        sampler: meta.sampler || null,
        scheduler: meta.scheduler || null,
        model_name: meta.model || meta.model_name || null,
        width: meta.width || null,
        height: meta.height || null,
        denoise: meta.denoise != null ? meta.denoise : null,
        loras: []
      };
      // Normalise loras to match ComfyUIParser output format.
      const loraList = meta.loras || (meta.detected_loras || meta.detectedLoras) || [];
      if (Array.isArray(loraList)) {
        for (const l of loraList) {
          const name = l.name || l.filename || l.workflowName || '';
          if (!name || name.toLowerCase() === 'none' || name.toLowerCase() === 'none.safetensors') continue;
          result.loras.push({
            name: this.comfyParser.cleanModelName(name),
            strength: l.strength != null ? l.strength : (l.strength_model != null ? l.strength_model : 1.0)
          });
        }
      }
      return result;
    } catch (_) {}
    return null;
  }

  // Parse A1111-style `parameters` text (auto1111/webui compatibility format).
  // Returns creative fields or null.
  tryParametersParse(text) {
    try {
      if (!text || typeof text !== 'string') return null;
      // The first line up to the first "\nSteps:" is the prompt.
      const firstBreak = text.indexOf('\nSteps:');
      const prompt = firstBreak > -1 ? text.substring(0, firstBreak).trim() : text.trim();
      if (!prompt) return null;

      const result = { prompt, loras: [] };
      const negMatch = text.match(/Negative prompt:\s*(.+?)(?:\n|$)/);
      if (negMatch) result.negative_prompt = negMatch[1].trim();
      const seedMatch = text.match(/Seed:\s*(\d+)/);
      if (seedMatch) result.seed = parseInt(seedMatch[1], 10);
      const stepsMatch = text.match(/Steps:\s*(\d+)/);
      if (stepsMatch) result.steps = parseInt(stepsMatch[1], 10);
      const cfgMatch = text.match(/CFG scale:\s*([\d.]+)/);
      if (cfgMatch) result.cfg_scale = parseFloat(cfgMatch[1]);
      const samplerMatch = text.match(/Sampler:\s*(\S+)/);
      if (samplerMatch) result.sampler = samplerMatch[1];
      const schedMatch = text.match(/Schedule type:\s*(\S+)/) || text.match(/Scheduler:\s*(\S+)/);
      if (schedMatch) result.scheduler = schedMatch[1];
      const sizeMatch = text.match(/Size:\s*(\d+)x(\d+)/);
      if (sizeMatch) { result.width = parseInt(sizeMatch[1], 10); result.height = parseInt(sizeMatch[2], 10); }
      const modelMatch = text.match(/Model:\s*(.+?)(?:,|$|\n)/);
      if (modelMatch) result.model_name = modelMatch[1].trim();
      const denoiseMatch = text.match(/Denoising strength:\s*([\d.]+)/);
      if (denoiseMatch) result.denoise = parseFloat(denoiseMatch[1]);

      // LoRAs in A1111 format: "Loras: name1:0.5, name2:0.8" or "LoRAs: name:0.5"
      const loraMatch = text.match(/(?:Loras|LoRAs):\s*(.+?)(?:\n|$)/);
      if (loraMatch) {
        const entries = loraMatch[1].split(',').map(s => s.trim());
        for (const entry of entries) {
          const parts = entry.split(':');
          if (parts.length >= 2) {
            const name = parts[0].trim();
            const strength = parseFloat(parts[1]);
            if (name && !isNaN(strength)) {
              result.loras.push({ name: this.comfyParser.cleanModelName(name), strength });
            }
          }
        }
      }
      return result;
    } catch (_) {}
    return null;
  }

  async parse(filePath) {
    try {
      const { parse: exifrParse } = exifr;

      let parsed = {};
      try {
        parsed = (await exifrParse(filePath, true)) || {};
      } catch (_) {
        parsed = {};
      }

      const attrs = {};
      if (parsed.ImageWidth) attrs.width = parsed.ImageWidth;
      if (parsed.ImageHeight) attrs.height = parsed.ImageHeight;

      // Try each metadata source in priority order.
      let comfyData = null;

      // 1. Standard `prompt` chunk (ComfyUI SaveImage / PreviewImage)
      if (!comfyData && parsed.prompt && typeof parsed.prompt === 'string') {
        comfyData = this.tryWorkflowParse(parsed.prompt);
      }

      // 2. `workflow` chunk (Krea2CivitaiSaveImage, etc.)
      if (!comfyData && parsed.workflow && typeof parsed.workflow === 'string') {
        comfyData = this.tryWorkflowParse(parsed.workflow);
      }

      // 3. `extraMetadata` structured JSON
      if (!comfyData && parsed.extraMetadata && typeof parsed.extraMetadata === 'string') {
        comfyData = this.tryExtraMetaParse(parsed.extraMetadata);
      }

      // 4. `parameters` A1111-style text
      if (!comfyData && parsed.parameters && typeof parsed.parameters === 'string') {
        comfyData = this.tryParametersParse(parsed.parameters);
      }

      // 5. EXIF UserComment (JPEG files — exifr returns raw bytes as an
      //    indexed object. The 9-byte header identifies the encoding:
      //    "UNICODE\0\0" = UTF-16LE workflow JSON or A1111 parameters
      //    "ASCII\0\0\0"  = plain ASCII (digital signature / non-relevant)
      //    After stripping the header, decode the remainder and try
      //    workflow JSON first, then A1111 parameters text.
      if (!comfyData) {
        const rawUC = parsed.userComment || parsed.UserComment;
        if (rawUC && typeof rawUC === 'object') {
          const keys = Object.keys(rawUC)
            .filter(k => /^\d+$/.test(k))
            .map(Number)
            .sort((a, b) => a - b);
          // Detect header: read first 7 bytes as ASCII
          const hdr = String.fromCharCode(...keys.slice(0, Math.min(7, keys.length)).map(k => rawUC[k]));
          const isUnicode = hdr === 'UNICODE';
          const isAscii = hdr === 'ASCII\x00';
          if (keys.length > 9 && (isUnicode || isAscii)) {
            let start = isUnicode ? 7 : 5; // "UNICODE\0\0" or "ASCII\0"
            while (start < keys.length && rawUC[keys[start]] === 0) start++;
            const payload = keys.slice(start).map(k => rawUC[k]);

            if (isUnicode) {
              const decoder = new TextDecoder('utf-16le');
              let decoded = decoder.decode(new Uint8Array(payload));
              // Trim trailing nulls / garbage after the last valid JSON token
              const jsonEnd = Math.max(decoded.lastIndexOf('}'), decoded.lastIndexOf(']'));
              if (jsonEnd > 0) decoded = decoded.substring(0, jsonEnd + 1);
              comfyData = this.tryWorkflowParse(decoded) || this.tryParametersParse(decoded);
            } else {
              // "ASCII" header — skip, not generation metadata
            }
          }
        }
      }

      if (comfyData) {
        // Normalise loras to a JSON string for DB storage.
        if (comfyData.loras && Array.isArray(comfyData.loras)) {
          comfyData.loras = comfyData.loras.length
            ? JSON.stringify(comfyData.loras)
            : null;
        }
        return { agent: 'comfyui', ...attrs, ...comfyData };
      }

      return { agent: 'comfyui', ...attrs };
    } catch (_) {
      return { agent: 'comfyui' };
    }
  }
}

module.exports = Parser;
