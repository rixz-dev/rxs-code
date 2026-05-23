import fs from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { homedir } from 'os';

const CACHE_DIR = resolve(homedir(), '.rxs-code-cache');
const CATALOG_FILE = resolve(CACHE_DIR, 'model-catalog.json');
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });

export class ModelCatalog {
  constructor() {
    this.catalog = {};
    this._loaded = false;
  }

  async _load() {
    if (this._loaded) return;
    try {
      if (existsSync(CATALOG_FILE)) {
        const raw = await fs.readFile(CATALOG_FILE, 'utf8');
        this.catalog = JSON.parse(raw).catalog || {};
      }
    } catch {
      this.catalog = {};
    }
    this._loaded = true;
  }

  async _save() {
    try {
      await fs.writeFile(CATALOG_FILE, JSON.stringify({
        catalog: this.catalog,
        updated: Date.now(),
      }, null, 2), 'utf8');
    } catch {}
  }

  async getCachedModels(provider) {
    await this._load();
    const entry = this.catalog[provider];
    if (!entry) return null;
    if (Date.now() - entry.timestamp > CACHE_TTL) return null;
    return entry.models;
  }

  async setCachedModels(provider, models) {
    await this._load();
    this.catalog[provider] = { models, timestamp: Date.now() };
    await this._save();
  }

  async getModels(providerInstance, providerName) {
    const cached = await this.getCachedModels(providerName);
    if (cached) return cached;

    try {
      const models = await providerInstance.listModels();
      await this.setCachedModels(providerName, models);
      return models;
    } catch {
      const fallback = providerInstance.getRecommendedModels().map(id => ({
        id, owned_by: providerName, contextWindow: null,
      }));
      await this.setCachedModels(providerName, fallback);
      return fallback;
    }
  }

  async invalidate(provider) {
    await this._load();
    delete this.catalog[provider];
    await this._save();
  }
}
