import fs from "fs/promises";
import { existsSync, mkdirSync } from "fs";
import { resolve } from "path";
import { homedir } from "os";

const CACHE_DIR = resolve(homedir(), ".rxs-code-cache");
const CACHE_FILE = resolve(CACHE_DIR, "prompts.json");
const TTL = 24 * 60 * 60 * 1000; // 24 jam

// Initialize cache directory
if (!existsSync(CACHE_DIR)) {
  mkdirSync(CACHE_DIR, { recursive: true });
}

export class PromptCache {
  constructor() {
    this.cache = {};
    this._loaded = false;
  }

  async _load() {
    if (this._loaded) return;
    try {
      if (existsSync(CACHE_FILE)) {
        const data = await fs.readFile(CACHE_FILE, "utf8");
        this.cache = JSON.parse(data);
      }
    } catch (e) {
      this.cache = {};
    }
    this._loaded = true;
  }

  async _save() {
    try {
      await fs.writeFile(CACHE_FILE, JSON.stringify(this.cache, null, 2), "utf8");
    } catch (e) {
      // ignore write errors
    }
  }

  async get(key) {
    await this._load();
    const entry = this.cache[key];
    if (!entry) return null;
    if (Date.now() - entry.timestamp > TTL) {
      delete this.cache[key];
      await this._save();
      return null;
    }
    return entry.value;
  }

  async set(key, value) {
    await this._load();
    this.cache[key] = { value, timestamp: Date.now() };
    await this._save();
  }

  async invalidate() {
    this.cache = {};
    await this._save();
  }
}

// Global instance
export const promptCache = new PromptCache();
