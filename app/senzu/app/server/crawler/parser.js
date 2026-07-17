// Senzu metadata parser — ComfyUI only.
// Reads PNG/JPEG EXIF/text chunks with exifr and dispatches ComfyUI workflow
// JSON (stored in the `prompt` text chunk) to the ComfyUIParser.

const exifr = require('exifr');
const ComfyUIParser = require('./comfyui');

class Parser {
  constructor() {
    this.comfyParser = new ComfyUIParser();
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

      // ComfyUI stores the workflow as a JSON string in the EXIF/PNG `prompt` chunk.
      if (parsed.prompt && typeof parsed.prompt === 'string') {
        try {
          const workflow = JSON.parse(parsed.prompt);
          if (workflow && typeof workflow === 'object') {
            const keys = Object.keys(workflow);
            if (keys.length > 0 && workflow[keys[0]] && workflow[keys[0]].class_type) {
              const comfyData = this.comfyParser.parse(workflow);
              if (comfyData) {
                // Normalise loras to a JSON string for DB storage.
                if (comfyData.loras && Array.isArray(comfyData.loras)) {
                  comfyData.loras = comfyData.loras.length
                    ? JSON.stringify(comfyData.loras)
                    : null;
                }
                return { agent: 'comfyui', ...attrs, ...comfyData };
              }
            }
          }
        } catch (_) {
          // Not a ComfyUI workflow — fall through to file-stats-only metadata.
        }
      }

      return { agent: 'comfyui', ...attrs };
    } catch (_) {
      return { agent: 'comfyui' };
    }
  }
}

module.exports = Parser;
