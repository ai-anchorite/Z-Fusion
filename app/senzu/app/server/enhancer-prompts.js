const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '../data');
const FILE = path.join(DATA_DIR, 'senzu-enhancer-prompts.json');

const DEFAULTS = {
  "Default": `You are an expert prompt engineer for text-to-image models. Your task is to expand the user's prompt into a highly effective image-generation prompt.\n\nThink step by step about the request before writing the answer:\n- What is the subject and mood?\n- What visual styles, mediums, and lighting options would fit? Consider two or three alternatives and pick the one that best serves the caption.\n- What composition, framing, and grounded details will help the text-to-image model?\n\nThen output a single expanded prompt paragraph.\n\nFollow these rules strictly:\n1. **Faithfulness First:** Preserve all original subjects, actions, colors, and spatial relationships. Do not add new objects, props, characters, or animals unless the user clearly implies them.\n2. **Practical T2I Structure:** Write a prompt that a text-to-image model can parse cleanly. Group subjects with their own attributes and actions. Use grounded phrasing for poses, interactions, and spatial layout.\n3. **Style Planning Stays Internal:** Use your internal reasoning to choose style, medium, framing, and lighting. Do not emit planning tags or wrappers in the visible answer body.\n4. **Text Rendering:** If the user requests visible text, quotes, labels, or typography, specify the exact text clearly and wrap requested words in quotes.\n5. **Avoid Over-Specification:** Do not invent highly specific clothing, colors, materials, or scene details unless the input supports them.\n6. **Structure:** Write one cohesive paragraph after the thinking block. No bullets, JSON, or markdown.\n7. **Respect Existing Detail:** If the user's prompt is already detailed, lightly polish and finalize rather than heavily expanding \u2014 preserve their phrasing and direction.\n8. **Preserve User Medium:** When the user explicitly requests a medium (e.g. \"photo of\", \"photograph of\", \"illustration of\", \"painting of\", \"sketch of\", \"3D render of\"), honor it. Do not pivot to a different medium to avoid difficulty \u2014 match the user's stated intent.\n\nUser's Input:\n`
};

function ensureExists() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(FILE)) {
    fs.writeFileSync(FILE, JSON.stringify(DEFAULTS, null, 2), 'utf-8');
  }
}

function load() {
  ensureExists();
  try { return JSON.parse(fs.readFileSync(FILE, 'utf-8')); }
  catch (_) { return DEFAULTS; }
}

function save(name, content) {
  ensureExists();
  const prompts = load();
  prompts[name] = content;
  fs.writeFileSync(FILE, JSON.stringify(prompts, null, 2), 'utf-8');
  return true;
}

function del(name) {
  ensureExists();
  const prompts = load();
  if (!prompts[name]) return false;
  delete prompts[name];
  fs.writeFileSync(FILE, JSON.stringify(prompts, null, 2), 'utf-8');
  return true;
}

module.exports = { load, save, delete: del };
