const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');

const DATA_DIR = path.join(__dirname, '../data');
const SETTINGS_FILE = path.join(DATA_DIR, 'senzu-settings.json');

const DEFAULT_SETTINGS = {
  save_folder: '',
  autosave: false,
  clear_temp_on_start: true,
  theme: 'Default',
  default_model_pack: ''
};

function ensureSettingsExist() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(SETTINGS_FILE)) {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(DEFAULT_SETTINGS, null, 2), 'utf-8');
  }
}

function loadSettings() {
  ensureSettingsExist();
  try {
    const data = fs.readFileSync(SETTINGS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (err) {
    console.error("Error reading settings:", err);
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(data) {
  ensureSettingsExist();
  try {
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
