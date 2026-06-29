const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '../data');
const FILE = path.join(DATA_DIR, 'senzu-gen-presets.json');

const DEFAULTS = {};

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

function save(name, data) {
  ensureExists();
  const presets = load();
  presets[name] = data;
  fs.writeFileSync(FILE, JSON.stringify(presets, null, 2), 'utf-8');
  return true;
}

function del(name) {
  ensureExists();
  const presets = load();
  if (!presets[name]) return false;
  delete presets[name];
  fs.writeFileSync(FILE, JSON.stringify(presets, null, 2), 'utf-8');
  return true;
}

module.exports = { load, save, delete: del };
