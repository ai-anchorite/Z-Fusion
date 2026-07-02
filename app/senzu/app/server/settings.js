const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');

const DATA_DIR = path.join(__dirname, '../data');
const SETTINGS_FILE = path.join(DATA_DIR, 'senzu-settings.json');
const SETTINGS_VERSION = 2;

const DEFAULT_SETTINGS = {
  save_folder: '',
  autosave: false,
  clear_temp_on_start: true,
  theme: 'Default',
  default_model_pack: '',
  enhancer_system_prompt: 'Refinement',
  enhancer_llm_model: 'qwen3vl_4b_fp8_scaled.safetensors',
  description_system_prompt: 'Description',
  description_llm_model: 'qwen3vl_4b_fp8_scaled.safetensors',
  enhancer_max_length: 512,
  enhancer_temperature: 0.7
};

function ensureSettingsExist() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  let existing = {};
  if (fs.existsSync(SETTINGS_FILE)) {
    try {
      existing = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
    } catch (_) {}
  }

  const version = existing._version || 0;
  if (!fs.existsSync(SETTINGS_FILE) || version < SETTINGS_VERSION) {
    const merged = { _version: SETTINGS_VERSION, ...DEFAULT_SETTINGS, ...existing };
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(merged, null, 2), 'utf-8');
  }
}

function loadSettings() {
  ensureSettingsExist();
  try {
    const data = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
    delete data._version;
    return data;
  } catch (err) {
    console.error("Error reading settings:", err);
    const copy = { ...DEFAULT_SETTINGS };
    return copy;
  }
}

function saveSettings(data) {
  ensureSettingsExist();
  try {
    data._version = SETTINGS_VERSION;
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(data, null, 2), 'utf-8');
    return { success: true };
  } catch (err) {
    console.error("Error saving settings:", err);
    return { success: false, error: err.message };
  }
}

function openFolder(folderPath) {
  try {
    if (!fs.existsSync(folderPath)) {
      fs.mkdirSync(folderPath, { recursive: true });
    }
    const cmd = process.platform === 'win32' ? 'explorer' : (process.platform === 'darwin' ? 'open' : 'xdg-open');
    exec(`"${cmd}" "${folderPath}"`);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function clearTempOutputs(outputTempDir) {
  try {
    if (!fs.existsSync(outputTempDir)) {
      return { success: true, message: 'No temp files to clear.' };
    }
    const files = fs.readdirSync(outputTempDir).filter(f => {
      const ext = path.extname(f).toLowerCase();
      return ['.png', '.jpg', '.jpeg', '.webp'].includes(ext);
    });
    files.forEach(f => {
      try { fs.unlinkSync(path.join(outputTempDir, f)); } catch (_) {}
    });
    return { success: true, count: files.length };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function copyOutputToFolder(srcPath, saveFolder, destName) {
  if (!saveFolder || !srcPath) return false;
  try {
    if (!fs.existsSync(saveFolder)) {
      fs.mkdirSync(saveFolder, { recursive: true });
    }
    const filename = destName || path.basename(srcPath);
    const destPath = path.join(saveFolder, filename);
    fs.copyFileSync(srcPath, destPath);
    console.log(`[Save] Copied to ${destPath}`);
    return true;
  } catch (err) {
    console.error(`[Save] Failed to copy ${srcPath}:`, err.message);
    return false;
  }
}

module.exports = {
  loadSettings,
  saveSettings,
  openFolder,
  clearTempOutputs,
  copyOutputToFolder,
  DEFAULT_SETTINGS
};
