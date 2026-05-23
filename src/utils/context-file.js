/**
 * context-file.js — Auto-load RXSCODE.md project context (like CLAUDE.md)
 * Searches cwd and parent directories for RXSCODE.md
 *
 * Supports YAML-like directives in a frontmatter block:
 *   ---
 *   provider: groq
 *   model: llama-3.3-70b-versatile
 *   skills: security, backend
 *   thinking: low
 *   temperature: 0.3
 *   ---
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import os from 'os';

const CONTEXT_FILENAMES = ['RXSCODE.md', '.rxscode.md', 'AGENTS.md'];
const MAX_TRAVERSE = 5; // max parent dirs to walk up

/**
 * Find context file by walking up from startDir
 */
export function findContextFile(startDir = process.cwd()) {
  let dir = startDir;
  for (let i = 0; i < MAX_TRAVERSE; i++) {
    for (const name of CONTEXT_FILENAMES) {
      const fp = join(dir, name);
      if (existsSync(fp)) return fp;
    }
    const parent = dirname(dir);
    if (parent === dir) break; // reached filesystem root
    dir = parent;
  }
  // Also check ~/.rxs-code/RXSCODE.md (global context)
  const global = join(os.homedir(), '.rxs-code', 'RXSCODE.md');
  if (existsSync(global)) return global;
  return null;
}

/**
 * Parse YAML-like frontmatter directives from context file.
 * Returns { directives, body } — body is the content without the frontmatter block.
 *
 * Supported directives:
 *   provider: <name>
 *   model: <model-id>
 *   skills: <comma-separated>
 *   thinking: off | low | medium | high | max
 *   temperature: <0-1>
 */
export function parseContextDirectives(content) {
  const directives = {};
  let body = content;

  // Match optional leading ---...--- frontmatter block
  const fmMatch = content.match(/^\s*---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (fmMatch) {
    const fm = fmMatch[1];
    body = content.slice(fmMatch[0].length).trim();

    for (const line of fm.split('\n')) {
      const m = line.match(/^(\w+)\s*:\s*(.+)$/);
      if (!m) continue;
      const [, key, val] = m;
      const v = val.trim();
      switch (key.toLowerCase()) {
        case 'provider':    directives.provider    = v; break;
        case 'model':       directives.model       = v; break;
        case 'thinking':    directives.thinking    = v; break;
        case 'temperature': directives.temperature = parseFloat(v); break;
        case 'skills':
          directives.skills = v.split(',').map(s => s.trim()).filter(Boolean);
          break;
      }
    }
  }

  return { directives, body };
}

/**
 * Load and return context file content + parsed directives
 */
export function loadContextFile(startDir = process.cwd()) {
  const fp = findContextFile(startDir);
  if (!fp) return null;
  try {
    const raw = readFileSync(fp, 'utf8').trim();
    const { directives, body } = parseContextDirectives(raw);
    return { path: fp, content: body, directives };
  } catch {
    return null;
  }
}

/**
 * Build system prompt injection from context file
 */
export function buildContextInjection(startDir = process.cwd()) {
  const ctx = loadContextFile(startDir);
  if (!ctx) return '';
  return `\n\n## Project Context (from ${ctx.path})\n\n${ctx.body || ctx.content}\n`;
}

/**
 * Create a starter RXSCODE.md in current directory
 */
export function initContextFile(overrides = {}) {
  const fp = join(process.cwd(), 'RXSCODE.md');
  if (existsSync(fp)) return { created: false, path: fp };

  const lines = [
    '---',
    `provider: ${overrides.provider || 'groq'}`,
    `model: ${overrides.model || 'auto'}`,
    `skills: ${overrides.skills || 'backend'}`,
    `thinking: ${overrides.thinking || 'off'}`,
    '---',
    '',
    `# ${overrides.name || 'Project Context'}`,
    '',
    '## About this project',
    '<!-- Describe your project here. AI will read this on every turn. -->',
    '',
    '## Key conventions',
    '<!-- File structure, naming rules, patterns to follow -->',
    '',
    '## Off-limits',
    '<!-- Files or patterns the AI should never modify -->',
  ].join('\n');

  writeFileSync(fp, lines, 'utf8');
  return { created: true, path: fp };
}
