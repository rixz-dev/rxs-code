/**
 * memory.js — Persistent cross-session memory notes
 * Stores notes in ~/.rxs-code/memory.md (like Claude Code /memory)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import os from 'os';

const MEMORY_DIR  = join(os.homedir(), '.rxs-code');
const MEMORY_FILE = join(MEMORY_DIR, 'memory.md');

function ensureDir() {
  if (!existsSync(MEMORY_DIR)) mkdirSync(MEMORY_DIR, { recursive: true });
}

/** Read all memory notes */
export function readMemory() {
  ensureDir();
  if (!existsSync(MEMORY_FILE)) return '';
  return readFileSync(MEMORY_FILE, 'utf8').trim();
}

/** Write (replace) all memory notes */
export function writeMemory(content) {
  ensureDir();
  writeFileSync(MEMORY_FILE, content.trim() + '\n', 'utf8');
}

/** Append a new note to memory */
export function addMemoryNote(note) {
  const existing = readMemory();
  const ts = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const line = `- [${ts}] ${note.trim()}`;
  writeMemory(existing ? existing + '\n' + line : `# rxs-code Memory\n\n${line}`);
  return line;
}

/** Remove a note by index (1-based) */
export function removeMemoryNote(index) {
  const lines = readMemory().split('\n');
  const noteLines = lines.filter(l => l.startsWith('- ['));
  if (index < 1 || index > noteLines.length) return false;
  const target = noteLines[index - 1];
  const updated = lines.filter(l => l !== target).join('\n');
  writeMemory(updated);
  return true;
}

/** Get notes as array (only bullet lines) */
export function listMemoryNotes() {
  return readMemory()
    .split('\n')
    .filter(l => l.startsWith('- ['))
    .map((l, i) => ({ index: i + 1, text: l }));
}

/** Clear all memory */
export function clearMemory() {
  writeMemory('# rxs-code Memory\n');
}

/** Memory file path (for /memory edit) */
export function memoryFilePath() {
  return MEMORY_FILE;
}
