const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '../data');
const PROMPTS_FILE = path.join(DATA_DIR, 'prompts.json');

const DEFAULT_PROMPTS = {
  "Cyberpunk Overhaul": "Reskin this image into a cyberpunk aesthetic. Bathe the scene in vibrant pink and cyan neon light reflecting off wet surfaces. Add atmospheric haze and flickering holographic details while maintaining the original composition.",
  "Classic Oil Painting": "Transform this image into a masterpiece oil painting. Use thick, visible impasto brushstrokes and painted using the images existing color palette. The lighting should mimic a Rembrandt painting, with a single light source creating a dramatic chiaroscuro effect.",
  "Ethereal Watercolor": "Convert the image into a delicate watercolor illustration.",
  "Vintage 35mm Film": "Apply a nostalgic 1970s film aesthetic. Introduce subtle film grain, slightly muted colors with a warm tint, and a gentle lens flare. The image should look like a candid moment captured on Kodak Portra 400.",
  "Studio Portrait": "Transform the subject to match a professional studio look. Use a clean, neutral background and 'Rembrandt' lighting.",
  "Fantasy Illustration": "Reimagine this scene as a high-fantasy digital art. Add magical atmospheric element. Use dramatic, epic lighting.",
  "Pencil Sketch": "Convert the image into a detailed graphite pencil drawing on textured paper. Focus on fine cross-hatching for shadows and clean, confident line work for the silhouettes, maintaining a hand-drawn, artistic feel.",
  "Golden Hour Glow": "Bathe the entire scene in the warm, golden hour glow of a late afternoon. Add long, soft shadows and a backlight that creates a beautiful rim-light around the edges of the subject.",
  "Anime Aesthetic": "Convert the image into a high-quality anime style. Use clean line art, vibrant cel-shaded colors, and expressive lighting. The background should have the detailed, painterly quality found in modern Japanese animation."
};

function ensurePromptsExist() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(PROMPTS_FILE)) {
    fs.writeFileSync(PROMPTS_FILE, JSON.stringify(DEFAULT_PROMPTS, null, 2), 'utf-8');
  }
}

function loadPrompts() {
  ensurePromptsExist();
  try {
    const data = fs.readFileSync(PROMPTS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (err) {
    console.error("Error reading prompts:", err);
    return DEFAULT_PROMPTS;
  }
}

function savePrompt(name, content) {
  ensurePromptsExist();
  const prompts = loadPrompts();
  prompts[name] = content;
  try {
    fs.writeFileSync(PROMPTS_FILE, JSON.stringify(prompts, null, 2), 'utf-8');
    return true;
  } catch (err) {
    console.error("Error saving prompt:", err);
    return false;
  }
}

function deletePrompt(name) {
  ensurePromptsExist();
  const prompts = loadPrompts();
  if (prompts[name]) {
    delete prompts[name];
    try {
      fs.writeFileSync(PROMPTS_FILE, JSON.stringify(prompts, null, 2), 'utf-8');
      return true;
    } catch (err) {
      console.error("Error deleting prompt:", err);
      return false;
    }
  }
  return false;
}

function resetPromptsToDefaults() {
  ensurePromptsExist();
  try {
    fs.writeFileSync(PROMPTS_FILE, JSON.stringify(DEFAULT_PROMPTS, null, 2), 'utf-8');
    return true;
  } catch (err) {
    console.error("Error resetting prompts:", err);
    return false;
  }
}

module.exports = {
  loadPrompts,
  savePrompt,
  deletePrompt,
  resetPromptsToDefaults,
  DEFAULT_PROMPTS
};
