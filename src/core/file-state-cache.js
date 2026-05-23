/**
 * FileStateCache — LRU cache untuk file reads.
 * Kalau AI baca file yang sama dan tidak berubah → return stub "unchanged"
 * bukan konten penuh. Hemat ~100x tokens untuk repeated reads.
 */

import fs from 'fs/promises';
import { normalize, resolve } from 'path';

// ─── Constants ────────────────────────────────────────────────────────────────

export const FILE_UNCHANGED_STUB =
  'File unchanged since last read. The content from the earlier ' +
  'read_file tool_result in this conversation is still current — ' +
  'refer to that instead of re-reading.';

const MAX_ENTRIES  = 100;
const MAX_SIZE_BYTES = 25 * 1024 * 1024; // 25MB total

// ─── Simple LRU Cache ─────────────────────────────────────────────────────────

class LRUCache {
  constructor(maxEntries, maxBytes) {
    this.maxEntries = maxEntries;
    this.maxBytes   = maxBytes;
    this.map        = new Map();   // key → { value, size, timestamp }
    this.totalBytes = 0;
  }

  _key(path) {
    return normalize(resolve(path));
  }

  get(path) {
    const k = this._key(path);
    const entry = this.map.get(k);
    if (!entry) return null;
    // Move to end (most recently used)
    this.map.delete(k);
    this.map.set(k, entry);
    return entry.value;
  }

  set(path, value) {
    const k    = this._key(path);
    const size = Buffer.byteLength(value.content || '');

    // Evict if over size limit
    while (this.totalBytes + size > this.maxBytes && this.map.size > 0) {
      const oldest = this.map.keys().next().value;
      const oldEntry = this.map.get(oldest);
      this.totalBytes -= oldEntry.size;
      this.map.delete(oldest);
    }

    // Evict if over entry limit
    while (this.map.size >= this.maxEntries) {
      const oldest = this.map.keys().next().value;
      const oldEntry = this.map.get(oldest);
      this.totalBytes -= oldEntry.size;
      this.map.delete(oldest);
    }

    // Evict old entry for same key
    if (this.map.has(k)) {
      this.totalBytes -= this.map.get(k).size;
      this.map.delete(k);
    }

    this.map.set(k, { value, size });
    this.totalBytes += size;
  }

  delete(path) {
    const k = this._key(path);
    const entry = this.map.get(k);
    if (entry) {
      this.totalBytes -= entry.size;
      this.map.delete(k);
    }
  }

  clear() {
    this.map.clear();
    this.totalBytes = 0;
  }

  get size() { return this.map.size; }
  get bytes() { return this.totalBytes; }
}

// ─── Singleton cache ──────────────────────────────────────────────────────────

const cache = new LRUCache(MAX_ENTRIES, MAX_SIZE_BYTES);

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Check if a file is unchanged since last read.
 * Returns: 'unchanged' | 'changed' | 'new'
 */
export async function checkFileState(filePath, startLine, endLine) {
  const absPath = resolve(filePath);
  const cached  = cache.get(absPath);
  if (!cached) return 'new';

  try {
    const stat = await fs.stat(absPath);
    const mtimeMs = stat.mtimeMs;

    // If mtime matches and range matches → unchanged
    if (
      mtimeMs === cached.mtimeMs &&
      (startLine || null) === (cached.startLine || null) &&
      (endLine   || null) === (cached.endLine   || null)
    ) {
      return 'unchanged';
    }
    return 'changed';
  } catch {
    return 'changed';
  }
}

/**
 * Store file content in cache after a successful read.
 */
export async function cacheFileRead(filePath, content, startLine, endLine) {
  const absPath = resolve(filePath);
  try {
    const stat = await fs.stat(absPath);
    cache.set(absPath, {
      content,
      mtimeMs: stat.mtimeMs,
      startLine: startLine || null,
      endLine:   endLine   || null,
    });
  } catch {
    // Non-fatal: skip caching
  }
}

/**
 * Invalidate cache for a file (call after write/edit).
 */
export function invalidateFile(filePath) {
  cache.delete(resolve(filePath));
}

/**
 * Cache stats for debugging.
 */
export function getCacheStats() {
  return {
    entries: cache.size,
    bytes: cache.bytes,
    maxEntries: MAX_ENTRIES,
    maxBytes: MAX_SIZE_BYTES,
    usedPercent: Math.round((cache.bytes / MAX_SIZE_BYTES) * 100),
  };
}

export function clearCache() {
  cache.clear();
}
