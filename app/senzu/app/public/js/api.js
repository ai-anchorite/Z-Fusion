const API_BASE = '/api';

const api = {
  async getStatus() {
    const res = await fetch(`${API_BASE}/status`);
    return res.json();
  },

  async interrupt() {
    const res = await fetch(`${API_BASE}/interrupt`, { method: 'POST' });
    return res.json();
  },

  async getSystemStats() {
    const res = await fetch(`${API_BASE}/system-stats`);
    return res.json();
  },

  async getComfySamplers() {
    const res = await fetch(`${API_BASE}/comfyui-samplers`);
    return res.json();
  },

  async getEnhancerPrompts() {
    const res = await fetch(`${API_BASE}/enhancer-prompts`);
    return res.json();
  },

  async saveEnhancerPrompt(name, content) {
    const res = await fetch(`${API_BASE}/enhancer-prompts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, content })
    });
    return res.json();
  },

  async deleteEnhancerPrompt(name) {
    const res = await fetch(`${API_BASE}/enhancer-prompts/${encodeURIComponent(name)}`, {
      method: 'DELETE'
    });
    return res.json();
  },

  async getGenPresets() {
    const res = await fetch(`${API_BASE}/gen-presets`);
    return res.json();
  },

  async saveGenPreset(name, data) {
    const res = await fetch(`${API_BASE}/gen-presets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, data })
    });
    return res.json();
  },

  async deleteGenPreset(name) {
    const res = await fetch(`${API_BASE}/gen-presets/${encodeURIComponent(name)}`, {
      method: 'DELETE'
    });
    return res.json();
  },

  async enhancePrompt(prompt, parameters, imageFile) {
    const formData = new FormData();
    formData.append('prompt', prompt);
    formData.append('parameters', JSON.stringify(parameters));
    if (imageFile) formData.append('image', imageFile);
    const res = await fetch(`${API_BASE}/enhance-prompt`, {
      method: 'POST',
      body: formData
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Enhancement failed');
    }
    return res.json();
  },

  async getGenEnhancerPrompts() {
    const res = await fetch(`${API_BASE}/gen-enhancer-prompts`);
    return res.json();
  },

  async saveGenEnhancerPrompt(name, content) {
    const res = await fetch(`${API_BASE}/gen-enhancer-prompts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, content })
    });
    return res.json();
  },

  async deleteGenEnhancerPrompt(name) {
    const res = await fetch(`${API_BASE}/gen-enhancer-prompts/${encodeURIComponent(name)}`, {
      method: 'DELETE'
    });
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

  async openModelFolder(type) {
    const res = await fetch(`${API_BASE}/models/open-folder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type })
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
  },

  async generateImage(parameters, imageFile, imageFileB) {
    const formData = new FormData();
    formData.append('parameters', JSON.stringify(parameters));
    if (imageFile) formData.append('image', imageFile);
    if (imageFileB) formData.append('image_b', imageFileB);
    const res = await fetch(`${API_BASE}/generate`, {
      method: 'POST',
      body: formData
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Generation failed');
    }
    return res.json();
  },

  // ===== Gallery =====
  gallery: {
    async search({ q = '', sort = 'btime', direction = -1, offset = 0, limit = 100 } = {}) {
      const params = new URLSearchParams({ q, sort, direction, offset, limit });
      const res = await fetch(`${API_BASE}/gallery/search?${params.toString()}`);
      return res.json();
    },

    async get(fingerprint) {
      const res = await fetch(`${API_BASE}/gallery/${encodeURIComponent(fingerprint)}`);
      if (!res.ok) throw new Error('Not found');
      return res.json();
    },

    async count() {
      const res = await fetch(`${API_BASE}/gallery/count`);
      return res.json();
    },

    async tags() {
      const res = await fetch(`${API_BASE}/gallery/tags`);
      return res.json();
    },

    async addTags(fingerprints, tags) {
      const res = await fetch(`${API_BASE}/gallery/tags/add`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fingerprints, tags })
      });
      return res.json();
    },

    async removeTags(fingerprints, tags) {
      const res = await fetch(`${API_BASE}/gallery/tags/remove`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fingerprints, tags })
      });
      return res.json();
    },

    async delete(fingerprints) {
      const res = await fetch(`${API_BASE}/gallery/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fingerprints })
      });
      return res.json();
    },

    async restore(fingerprints) {
      const res = await fetch(`${API_BASE}/gallery/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fingerprints })
      });
      return res.json();
    },

    async trash() {
      const res = await fetch(`${API_BASE}/gallery/trash`);
      return res.json();
    },

    async emptyTrash() {
      const res = await fetch(`${API_BASE}/gallery/trash/empty`, { method: 'POST' });
      return res.json();
    },

    async openFolder(fingerprint) {
      const res = await fetch(`${API_BASE}/gallery/open`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fingerprint })
      });
      return res.json();
    },

    async openTrashFolder() {
      const res = await fetch(`${API_BASE}/gallery/trash/open`, { method: 'POST' });
      return res.json();
    },

    async reindex() {
      const res = await fetch(`${API_BASE}/gallery/reindex`, { method: 'POST' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Re-index failed');
      }
      return res.json();
    },

    async folders() {
      const res = await fetch(`${API_BASE}/gallery/folders`);
      return res.json();
    },

    async pickFolder() {
      const res = await fetch(`${API_BASE}/gallery/pick-folder`, { method: 'POST' });
      return res.json();
    },

    async addFolder(path, recursive) {
      const res = await fetch(`${API_BASE}/gallery/folders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, recursive })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to add folder');
      }
      return res.json();
    },

    async removeFolder(path) {
      const res = await fetch(`${API_BASE}/gallery/folders`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to remove folder');
      }
      return res.json();
    },

    async reindexFolder(path) {
      const res = await fetch(`${API_BASE}/gallery/folders/reindex`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path })
      });
      return res.json();
    },

    async getSetting(key) {
      const res = await fetch(`${API_BASE}/gallery/settings/${encodeURIComponent(key)}`);
      return res.json();
    },

    async setSetting(key, val) {
      const res = await fetch(`${API_BASE}/gallery/settings/${encodeURIComponent(key)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ val })
      });
      return res.json();
    },

    async favorites() {
      const res = await fetch(`${API_BASE}/gallery/favorites`);
      return res.json();
    },

    async addFavorite(query, label, isGlobal) {
      const res = await fetch(`${API_BASE}/gallery/favorites`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, label, isGlobal })
      });
      return res.json();
    },

    async removeFavorite(id) {
      const res = await fetch(`${API_BASE}/gallery/favorites/${encodeURIComponent(id)}`, {
        method: 'DELETE'
      });
      return res.json();
    }
  }
};
