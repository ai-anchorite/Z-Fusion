const API_BASE = '/api';

const api = {
  async getStatus() {
    const res = await fetch(`${API_BASE}/status`);
    return res.json();
  },

  async getSystemStats() {
    const res = await fetch(`${API_BASE}/system-stats`);
    return res.json();
  },
  
  async getPresets() {
    const res = await fetch(`${API_BASE}/presets`);
    return res.json();
  },
  
  async savePreset(name, data) {
    const res = await fetch(`${API_BASE}/presets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, data })
    });
    return res.json();
  },
  
  async deletePreset(name) {
    const res = await fetch(`${API_BASE}/presets/${encodeURIComponent(name)}`, {
      method: 'DELETE'
    });
    return res.json();
  },
  
  async getPrompts() {
    const res = await fetch(`${API_BASE}/prompts`);
    return res.json();
  },
  
  async savePrompt(name, content) {
    const res = await fetch(`${API_BASE}/prompts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, content })
    });
    return res.json();
  },
  
  async deletePrompt(name) {
    const res = await fetch(`${API_BASE}/prompts/${encodeURIComponent(name)}`, {
      method: 'DELETE'
    });
    return res.json();
  },
  
  async resetPrompts() {
    const res = await fetch(`${API_BASE}/prompts/reset`, {
      method: 'POST'
    });
    return res.json();
  },
  
  async getModels() {
    const res = await fetch(`${API_BASE}/models`);
    return res.json();
  },
  
  async getDownloadStatus() {
    const res = await fetch(`${API_BASE}/models/download-status`);
    return res.json();
  },
  
  async startDownload(repo, filename, type, dest_filename) {
    const body = { repo, filename, type };
    if (dest_filename) body.dest_filename = dest_filename;
    const res = await fetch(`${API_BASE}/models/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    return res.json();
  },

  async getModelPacks() {
    const res = await fetch(`${API_BASE}/model-packs`);
    return res.json();
  },

  async saveModelPack(name, data) {
    const res = await fetch(`${API_BASE}/model-packs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, data })
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error);
    }
    return res.json();
  },

  async deleteModelPack(name) {
    const res = await fetch(`${API_BASE}/model-packs/${encodeURIComponent(name)}`, {
      method: 'DELETE'
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error);
    }
    return res.json();
  },

  async setDefaultModelPack(name) {
    const res = await fetch(`${API_BASE}/model-packs/set-default`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    return res.json();
  },
  
  async getSettings() {
    const res = await fetch(`${API_BASE}/settings`);
    return res.json();
  },
  
  async saveSettings(data) {
    const res = await fetch(`${API_BASE}/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    return res.json();
  },
  
  async openOutputs(folder) {
    const res = await fetch(`${API_BASE}/settings/open-outputs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder })
    });
    return res.json();
  },
  
  async saveOutputToFolder(filename, save_folder, destName) {
    const res = await fetch(`${API_BASE}/outputs/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename, save_folder, destName })
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error);
    }
    return res.json();
  },
  
  async clearTempOutputs() {
    const res = await fetch(`${API_BASE}/outputs/clear-temp`, {
      method: 'POST'
    });
    return res.json();
  },
  
  async enhanceImage(file, mode, parameters, onProgress) {
    const formData = new FormData();
    if (file) {
      formData.append('image', file);
    }
    formData.append('mode', mode);
    formData.append('parameters', JSON.stringify(parameters));
    
    const xhr = new XMLHttpRequest();
    const promise = new Promise((resolve, reject) => {
      xhr.open('POST', `${API_BASE}/enhance`);
      
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            resolve(JSON.parse(xhr.responseText));
          } catch (e) {
            reject(new Error("Failed to parse response: " + e.message));
          }
        } else {
          try {
            const err = JSON.parse(xhr.responseText);
            reject(new Error(err.error || `Failed with status ${xhr.status}`));
          } catch (e) {
            reject(new Error(`Failed with status ${xhr.status}: ${xhr.responseText}`));
          }
        }
      };
      
      xhr.onerror = () => reject(new Error("Network connection error."));
      xhr.send(formData);
    });
    
    return promise;
  }
};
