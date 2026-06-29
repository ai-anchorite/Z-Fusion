const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '../data');
const PROMPTS_FILE = path.join(DATA_DIR, 'prompts.json');

const DEFAULT_PROMPTS = {
  "Adonis Detail Refine": "uhdmanscale, fully reconstruct this entire image from cellphone quality to professional high resolution color raw quality. Remove halftone dot pattern. Apply descreen filter. Eliminate periodic grid noise. Eliminate repeating noise patterns and artifacts, remove uniform diagonal line texture patterns. Reconstruct low resolution high ISO noise areas with high resolution low ISO noise textures.\n\nApply full detail reconstruction to all areas: background, environment, surfaces, objects, clothing, and foreground elements — render everything sharp, textured, and high fidelity.\n\nSubject identity is locked: preserve exact facial geometry and body geometry, eye shape and color, nose and mouth shape, and expression. On skin areas, remove color blotch artifacts, normalize tone uniformity, preserve natural pore and texture detail. On hair and body hair areas, separate smeared color artifacts, restore strand separation and texture. Outside the subject's face, freely reconstruct all texture and sharpness with no restrictions.\n\nDeblur and focus correction pass. Infer and reconstruct underlying detail from soft source: sharpen edge definition, recover eye detail, lip definition, and skin texture from motion blur. Output as professional high resolution color camera RAW image",

  "Clean Detail Boost": "Enhance this image with crisp, natural detail. Sharpen edges and fine textures without oversharpening. Recover subtle details in shadows and highlights. Improve micro-contrast across the entire image while preserving the original color balance and lighting. Remove compression artifacts and noise while maintaining natural grain texture.",

  "Restore Old Photo": "Restore this vintage or degraded photograph. Remove scratches, dust spots, and film grain. Reconstruct faded areas and repair torn or damaged regions. Correct color fading and restore original vibrancy. Enhance facial features and clothing details with period-appropriate texture. Preserve the authentic vintage character while bringing back clarity and detail.",

  "Cinematic Grade": "Apply a cinematic color grade to this image. Introduce subtle teal and orange color contrast for a modern film look. Deepen shadows with a slight blue tint and warm the midtones. Add a subtle vignette to draw focus to the subject. Enhance specular highlights for a polished, high-budget production appearance. Maintain natural skin tones.",

  "Anime Style": "Transform this image into a high-quality anime style illustration. Use clean line art with consistent stroke weight, vibrant cel-shaded colors with subtle gradients, and expressive lighting with rim light highlights. Render the background with the detailed, painterly quality found in modern Japanese animation. Preserve the original composition and character poses.",

  "Studio Portrait": "Transform the scene into a professional studio portrait. Apply soft, diffused studio lighting with a clean background separation. Use subtle Rembrandt-style key light with gentle fill. Enhance eye catchlights and skin texture for a polished magazine-cover finish. Maintain natural proportions and preserve the subject's likeness.",

  "Golden Hour Warmth": "Enhance this image with warm, natural golden hour lighting. Introduce soft, directional sunlight with long gentle shadows. Apply a warm amber and gold color cast to the highlights while keeping shadows slightly cool for depth. Add subtle lens flare and atmospheric haze for an ethereal, dreamlike quality. Preserve all subject details.",

  "Cyberpunk Night": "Reimagine this scene with a cyberpunk aesthetic. Introduce vibrant neon lighting in pink, cyan, and electric blue reflecting off wet surfaces and metallic elements. Add volumetric fog and atmospheric haze with floating particles. Deepen shadows to near-black while keeping neon highlights crisp. Add subtle holographic UI elements and lens flares. Preserve the original composition and subject identity.",

  "Natural HDR Look": "Apply a natural HDR enhancement to this image. Recover detail from overexposed highlights and underexposed shadows. Expand the dynamic range while maintaining a natural, non-artificial appearance. Enhance local contrast and texture clarity. Improve saturation subtly without making colors look processed. The result should look like a well-exposed professional photograph, not an over-processed HDR composite.",

  "Photographic Translation": "Reskin this entire image into a raw, high-resolution photograph. Convert all stylized surfaces into their real-world material counterparts with organic textures, high-fidelity details, and natural light-wrap. Maintain the exact composition and elements, but render them with the optical clarity and color science of a professional full-frame camera sensor.",

  "Optical Realism": "Render this scene as if captured through a high-quality 35mm lens. Apply realistic optical characteristics: a natural depth of field, and authentic light physics. Transform the current art style into a grounded, photographic reality without adding any new elements to the composition."
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
