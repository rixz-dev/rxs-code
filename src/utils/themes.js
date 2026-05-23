/**
 * themes.js — Color theme system for rxs-code
 * 5 themes: dark (default), cyber, amoled, matrix, amber
 */

import chalk from 'chalk';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import os from 'os';

const CONFIG_DIR  = join(os.homedir(), '.rxs-code');
const THEME_FILE  = join(CONFIG_DIR, 'theme.json');

// ─── Theme Definitions ────────────────────────────────────────────────────────

export const THEMES = {
  dark: {
    name: 'dark',
    description: 'Default dark theme',
    brand:   (s) => chalk.hex('#7C3AED')(s),   // purple
    green:   (s) => chalk.hex('#10B981')(s),   // emerald
    red:     (s) => chalk.hex('#EF4444')(s),   // red
    yellow:  (s) => chalk.hex('#F59E0B')(s),   // amber
    blue:    (s) => chalk.hex('#3B82F6')(s),   // blue
    dim:     (s) => chalk.hex('#6B7280')(s),   // gray
    muted:   (s) => chalk.hex('#374151')(s),   // dark gray
    border:  '─',
    bullet:  '◈',
    check:   '✓',
    cross:   '✖',
    arrow:   '→',
  },
  cyber: {
    name: 'cyber',
    description: 'Cyberpunk neon green on black',
    brand:   (s) => chalk.hex('#00FF41')(s),   // matrix green
    green:   (s) => chalk.hex('#00FF41')(s),
    red:     (s) => chalk.hex('#FF003C')(s),   // neon red
    yellow:  (s) => chalk.hex('#FFE600')(s),   // neon yellow
    blue:    (s) => chalk.hex('#00CFFF')(s),   // cyan
    dim:     (s) => chalk.hex('#00AA2B')(s),   // dim green
    muted:   (s) => chalk.hex('#004D15')(s),   // very dim green
    border:  '━',
    bullet:  '▸',
    check:   '⊕',
    cross:   '⊗',
    arrow:   '⟹',
  },
  amoled: {
    name: 'amoled',
    description: 'Pure black AMOLED — white accent',
    brand:   (s) => chalk.white(s),
    green:   (s) => chalk.hex('#AAFFAA')(s),
    red:     (s) => chalk.hex('#FF6666')(s),
    yellow:  (s) => chalk.hex('#FFDD66')(s),
    blue:    (s) => chalk.hex('#66AAFF')(s),
    dim:     (s) => chalk.hex('#555555')(s),
    muted:   (s) => chalk.hex('#222222')(s),
    border:  '─',
    bullet:  '●',
    check:   '✓',
    cross:   '✗',
    arrow:   '→',
  },
  matrix: {
    name: 'matrix',
    description: 'Matrix — cascading green',
    brand:   (s) => chalk.hex('#39FF14')(s),   // neon green
    green:   (s) => chalk.hex('#39FF14')(s),
    red:     (s) => chalk.hex('#FF3300')(s),
    yellow:  (s) => chalk.hex('#CCFF00')(s),
    blue:    (s) => chalk.hex('#00FF99')(s),
    dim:     (s) => chalk.hex('#1A6600')(s),
    muted:   (s) => chalk.hex('#0A2900')(s),
    border:  '│',
    bullet:  '▶',
    check:   '■',
    cross:   '□',
    arrow:   '▷',
  },
  amber: {
    name: 'amber',
    description: 'Retro amber terminal',
    brand:   (s) => chalk.hex('#FFB300')(s),   // amber
    green:   (s) => chalk.hex('#FFA000')(s),
    red:     (s) => chalk.hex('#FF6D00')(s),
    yellow:  (s) => chalk.hex('#FFD54F')(s),
    blue:    (s) => chalk.hex('#FFCA28')(s),
    dim:     (s) => chalk.hex('#996200')(s),
    muted:   (s) => chalk.hex('#3D2600')(s),
    border:  '─',
    bullet:  '◆',
    check:   '◈',
    cross:   '◇',
    arrow:   '»',
  },
};

// ─── Active Theme State ───────────────────────────────────────────────────────

let _active = null;

function ensureDir() {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
}

export function loadTheme() {
  ensureDir();
  try {
    if (existsSync(THEME_FILE)) {
      const saved = JSON.parse(readFileSync(THEME_FILE, 'utf8'));
      if (THEMES[saved.name]) {
        _active = THEMES[saved.name];
        return _active;
      }
    }
  } catch {}
  _active = THEMES.dark;
  return _active;
}

export function saveTheme(name) {
  ensureDir();
  if (!THEMES[name]) throw new Error(`Unknown theme: ${name}`);
  writeFileSync(THEME_FILE, JSON.stringify({ name }, null, 2), 'utf8');
  _active = THEMES[name];
  return _active;
}

export function getTheme() {
  return _active || loadTheme();
}

export function listThemes() {
  return Object.values(THEMES).map(t => ({
    name: t.name,
    description: t.description,
    active: t.name === getTheme().name,
  }));
}
