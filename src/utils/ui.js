/**
 * RXS Code — UI v2  (Claude Code-inspired, no box drawing)
 */
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import chalk from 'chalk';
import stripAnsi from 'strip-ansi';
import ora from 'ora';
import readline from 'readline/promises';

// ── Palette ────────────────────────────────────────────────────
export const C = {
  brand:  t => chalk.hex('#a78bfa')(t),
  dim:    t => chalk.dim(t),
  white:  t => chalk.white(t),
  orange: t => chalk.hex('#fb923c')(t),
  green:  t => chalk.hex('#4ade80')(t),
  red:    t => chalk.hex('#f87171')(t),
  cyan:   t => chalk.hex('#22d3ee')(t),
  yellow: t => chalk.hex('#fbbf24')(t),
  bold:    t => chalk.bold(t),
  road:    t => chalk.hex('#a78bfa').bold(t),
  // aliases used in cli.js
  success: t => chalk.hex('#4ade80')(t),
  error:   t => chalk.hex('#f87171')(t),
  warn:    t => chalk.hex('#fbbf24')(t),
  ai:      t => chalk.hex('#a78bfa')(t),
  user:    t => chalk.hex('#fb923c')(t),
};

export const getWidth = () => Math.min(process.stdout.columns || 80, 120);

// ── Banner ─────────────────────────────────────────────────────
export function printBanner(providerName, model, cfg) {
  const ctx   = cfg?.contextWindow ? `${Math.round(cfg.contextWindow / 1000)}k ctx` : '';
  const think = cfg?.thinking && cfg.thinking !== 'off' ? `thinking ${cfg.thinking}` : '';
  const tools = cfg?.toolsEnabled !== false ? 'tools on' : 'tools off';

  const parts = [
    C.brand('rxs-code'),
    C.dim('v1.0.0'),
    C.dim('·'),
    chalk.white(providerName.toLowerCase()),
    C.dim('/'),
    chalk.white(model),
    ctx   ? C.dim('· ' + ctx)   : '',
    think ? C.dim('· ' + think) : '',
    C.dim('· ' + tools),
  ].filter(Boolean).join(' ');

  const w    = getWidth();
  const cmds = '/help  /model  /provider  /thinking  /status  /save  /load  /clear';
  const disp = cmds.length > w - 4 ? cmds.slice(0, w - 5) + '…' : cmds;

  console.log('');
  console.log('  ' + parts);
  console.log('  ' + C.dim(disp));
  console.log('');
}

// ── User turn ──────────────────────────────────────────────────
export function printUserBox(text) {
  const w = getWidth();
  console.log('');
  console.log('  ' + C.dim('─'.repeat(w - 2)));
  text.split('\n').forEach((line, i) => {
    console.log('  ' + (i === 0 ? C.orange('›') : ' ') + ' ' + chalk.white(line));
  });
  console.log('');
}

// ── AI turn ────────────────────────────────────────────────────
export function printAIHeader(providerName, model) {
  const w = getWidth();
  console.log('  ' + C.dim('─'.repeat(w - 2)));
  console.log('  ' + C.brand('◆') + '  ' + C.dim(providerName.toLowerCase() + ' / ' + model));
  console.log('');
}

export function printAIFooterLine() {
  const w = getWidth();
  console.log('');
  console.log('  ' + C.dim('─'.repeat(w - 2)));
}

// Streaming buffer
let _streamBuf = '';
let _streamStarted = false;

export function printAILine(text) {
  console.log('  ' + text);
}

export function streamChunk(chunk) {
  if (!_streamStarted) {
    _streamStarted = true;
  }
  _streamBuf += chunk;
  // flush complete lines
  const lines = _streamBuf.split('\n');
  _streamBuf = lines.pop(); // keep incomplete line in buffer
  for (const line of lines) {
    process.stdout.write('  ' + line + '\n');
  }
}

export function streamFlush() {
  if (_streamBuf) {
    process.stdout.write('  ' + _streamBuf + '\n');
    _streamBuf = '';
  }
  _streamStarted = false;
}

export function printAIFooter() {
  console.log('');
}

// ── Error / Info ───────────────────────────────────────────────
export function printErrorBox(msg) {
  console.log('');
  console.log('  ' + C.red('✖') + '  ' + chalk.white(msg));
  console.log('');
}

export function printInfoBox(msg, label = 'INFO') {
  console.log('  ' + C.brand('◈') + '  ' + C.dim(label.toLowerCase() + '  ·  ') + chalk.white(msg));
}

// ── Tool badge ─────────────────────────────────────────────────
export function printToolBadge(toolName, detail = '') {
  const d = detail ? C.dim('  ·  ' + String(detail).slice(0, 64)) : '';
  console.log('  ' + C.cyan('⟳') + '  ' + chalk.white(toolName) + d);
}

export function printAutoContinueBadge(n, max) {
  console.log('  ' + C.dim('↻  auto-continue ' + n + '/' + max));
}

export function printRetryBadge(n, max, delay) {
  console.log('  ' + C.yellow('⚠') + '  ' + C.dim('retry ' + n + '/' + max + '  ·  ' + delay + 'ms'));
}

// ── Roadmap ────────────────────────────────────────────────────
export function parseRoadmap(text) {
  // Only treat as roadmap if there's an explicit plan/roadmap header
  const HEADERS = /(?:^|\n)#+\s*(?:plan|roadmap|steps|task|todo|langkah)/i;
  if (!HEADERS.test(text)) return null;

  const steps = [];
  let inSection = false;
  for (const line of text.split('\n')) {
    if (HEADERS.test(line)) { inSection = true; continue; }
    if (inSection) {
      const m = line.match(/^\s*[·•\-*\d+\.]+\s+(.+)/);
      if (m) steps.push({ label: m[1].trim(), done: false });
      else if (line.trim() === '') continue;
      else if (/^#+/.test(line)) break; // new section = stop
    }
  }
  return steps.length >= 2 ? { steps, current: 0 } : null;
}

export function printRoadmapStatus(roadmap) {
  if (!roadmap?.steps?.length) return;
  console.log('');
  roadmap.steps.forEach((s, i) => {
    const icon = s.done
      ? C.green('✓')
      : i === roadmap.current ? C.brand('●') : C.dim('○');
    console.log('  ' + icon + '  ' + (s.done ? C.dim(s.label) : chalk.white(s.label)));
  });
  console.log('');
}

export function buildRoadmapContinuePrompt(roadmap) {
  if (!roadmap?.steps?.length) return '';
  const rem = roadmap.steps.slice(roadmap.current).map(s => '- ' + s.label).join('\n');
  return '\n\nContinue with remaining steps:\n' + rem;
}

// ── Spinner (singleton — no concurrent conflict) ───────────────
let _sp = null;

export function createSpinner(status = 'loading') {
  if (_sp) { try { _sp.stop(); } catch {} _sp = null; }
  const labels = { loading: 'thinking…', connecting: 'connecting…', tool: 'running…' };
  _sp = ora({
    text:    C.dim(labels[status] || status),
    spinner: { interval: 100, frames: ['◐','◓','◑','◒'] },
    color:   'magenta',
  }).start();
  return {
    stop:   () => { if (_sp) { _sp.stop(); _sp = null; } },
    update: t  => { if (_sp) _sp.text = C.dim(t); },
  };
}

export function stopActiveSpinner() {
  if (_sp) { try { _sp.stop(); } catch {} _sp = null; }
}

// ── Model history ──────────────────────────────────────────────
const HIST = join(homedir(), '.rxscode', 'model-history.json');

async function loadModelHistory() {
  try {
    const dir = join(homedir(), '.rxscode');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    if (!existsSync(HIST)) return {};
    const { readFile } = await import('fs/promises');
    return JSON.parse(await readFile(HIST, 'utf8'));
  } catch { return {}; }
}

export async function saveModelHistory(provName, model) {
  const h = await loadModelHistory();
  if (!h[provName]) h[provName] = [];
  h[provName] = [model, ...h[provName].filter(m => m !== model)].slice(0, 5);
  const { writeFile } = await import('fs/promises');
  const dir = join(homedir(), '.rxscode');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  await writeFile(HIST, JSON.stringify(h, null, 2));
}

// ── Model selector ─────────────────────────────────────────────
export async function modelSelector(provider, currentModel, existingRl = null) {
  const h    = await loadModelHistory();
  const rec  = (h[provider.name] || []).slice(0, 5);
  const reco = (provider.getRecommendedModels?.() || []).filter(m => !rec.includes(m));
  const cur  = currentModel || provider.defaultModel;
  const all  = [...new Set([...rec, ...reco])];

  console.log('');
  console.log('  ' + C.brand('◆') + '  ' + C.dim('model  ·  ' + provider.name.toLowerCase()));
  console.log('');

  if (rec.length) {
    console.log('  ' + C.dim('recent'));
    rec.forEach((m, i) => {
      const tag = i === 0 ? C.dim('  ← last') : '';
      console.log('    ' + C.dim(String(i + 1).padStart(2)) + '  ' + chalk.white(m) + tag);
    });
    console.log('');
  }

  if (reco.length) {
    console.log('  ' + C.dim('recommended'));
    reco.forEach((m, i) => {
      const n = rec.length + i + 1;
      console.log('    ' + C.dim(String(n).padStart(2)) + '  ' + chalk.white(m));
    });
    console.log('');
  }

  console.log('  ' + C.dim('current  ') + chalk.white(cur));
  console.log('  ' + C.dim('enter number, model id, or ↵ to keep'));
  console.log('');

  const rl = existingRl || readline.createInterface({ input: process.stdin, output: process.stdout });
  process.stdout.write('  ' + C.brand('>') + ' ');
  const inp = (await rl.question('')).trim();
  if (!existingRl) rl.close();

  if (!inp) return cur;
  if (inp.startsWith('/')) {
    console.log('  ' + C.dim('  cancelled — kept ' + cur));
    return { model: cur, passthrough: inp };
  }
  const n = parseInt(inp, 10);
  if (!isNaN(n) && n >= 1 && n <= all.length) {
    await saveModelHistory(provider.name, all[n - 1]);
    return all[n - 1];
  }
  await saveModelHistory(provider.name, inp);
  return inp;
}
