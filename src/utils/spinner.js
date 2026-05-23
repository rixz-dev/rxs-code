/**
 * RxsSpinner — Premium spinner engine for rxs-code v4
 *
 * Features ported + adapted from Claude Code source analysis:
 *   • Shimmer animation  — bright window sweeps left→right across verb text
 *   • Palindrome frames  — smooth bounce without jarring reset
 *   • Random verb picker — per-status pool, task-aware
 *   • Stall detection    — turns red after 3s without a token notification
 *   • Token budget bar   — ▰▰▰▱▱▱ fill visualization
 *   • Reduced motion     — static "…" fallback via NO_MOTION env
 *   • Thinking timer     — tracks duration, prints "thought for Ns" on stop
 */

import chalk from 'chalk';
import process from 'process';

// ─── Reduced Motion ───────────────────────────────────────────────────────────

export const prefersReducedMotion =
  !!process.env.NO_MOTION ||
  !!process.env.REDUCE_MOTION ||
  !!process.env.NO_COLOR ||
  process.env.TERM === 'dumb';

// ─── Spinner Frames (palindrome = smooth bounce) ──────────────────────────────

const BASE_FRAMES = ['◐', '◓', '◑', '◒'];
const SPINNER_FRAMES = [...BASE_FRAMES, ...[...BASE_FRAMES].reverse()];
// → ◐ ◓ ◑ ◒ ◒ ◑ ◓ ◐ ◐ ◓ ◑ ◒ ...  (never a hard jump)

const STALL_FRAMES = ['✕', '!', '✕', '!']; // red stall indicator

// ─── Verb Pools ───────────────────────────────────────────────────────────────

const VERB_POOLS = {
  thinking:     ['Thinking',      'Reasoning',   'Processing',  'Contemplating', 'Analyzing',  'Pondering'],
  streaming:    ['Generating',    'Writing',      'Crafting',    'Composing',     'Drafting',   'Producing'],
  connecting:   ['Connecting',    'Initializing', 'Starting',    'Handshaking'],
  tool_read:    ['Reading',       'Loading',      'Scanning',    'Parsing',       'Inspecting'],
  tool_write:   ['Writing',       'Saving',       'Applying',    'Patching',      'Updating'],
  tool_shell:   ['Running',       'Executing',    'Processing',  'Spawning'],
  tool_grep:    ['Searching',     'Scanning',     'Indexing',    'Grepping',      'Hunting'],
  tool_web:     ['Fetching',      'Loading',      'Requesting',  'Pulling'],
  tool_generic: ['Working',       'Processing',   'Running',     'Handling'],
};

function pickVerb(status) {
  const pool = VERB_POOLS[status] || VERB_POOLS.tool_generic;
  return pool[Math.floor(Math.random() * pool.length)];
}

// ─── Shimmer Engine ───────────────────────────────────────────────────────────
//
//  Text: "Analyzing…"
//  Glimmer window (3 chars wide) sweeps left→right then wraps.
//
//  Frame 0: [dim]Analyzing…        (window at pos -3, nothing bright yet)
//  Frame 3: [dim]Ana[bright]lyz[dim]ing…
//  Frame 7: [dim]Analyzi[bright]ng…
//  Frame 9: [dim]Analyzing[bright]…
//  → wraps back to 0

const SHIMMER_WINDOW = 3;   // chars illuminated at once
const SHIMMER_SPEED  = 60;  // ms per position step

function computeGlimmerIndex(elapsed, textLen) {
  // Full cycle = textLen + SHIMMER_WINDOW steps (so window can fully enter + exit)
  const cycle = textLen + SHIMMER_WINDOW;
  const pos   = Math.floor(elapsed / SHIMMER_SPEED) % cycle;
  return pos - SHIMMER_WINDOW; // starts negative (window not yet in text)
}

function renderShimmerVerb(text, glimmerPos, stalled) {
  if (stalled) {
    return chalk.red(text);
  }

  if (prefersReducedMotion) {
    return chalk.dim(text);
  }

  let result = '';
  for (let i = 0; i < text.length; i++) {
    const distFromCenter = Math.abs(i - glimmerPos);
    if (distFromCenter <= SHIMMER_WINDOW) {
      // Intensity falls off from center: center=white.bold, edge=white, outer=dim
      if (distFromCenter === 0) {
        result += chalk.white.bold(text[i]);
      } else if (distFromCenter <= 1) {
        result += chalk.white(text[i]);
      } else {
        result += chalk.hex('#9ca3af')(text[i]); // dim-ish
      }
    } else {
      result += chalk.dim(text[i]);
    }
  }
  return result;
}

// ─── Token Budget Bar ─────────────────────────────────────────────────────────

/**
 * renderTokenBudgetBar(1234, 5000)
 * → "▰▰▰▰▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱ 1,234 / 5,000 (24%)"
 */
export function renderTokenBudgetBar(current, total, barWidth = 20) {
  if (!total || total <= 0) return '';
  const pct    = Math.min(1, current / total);
  const filled = Math.round(pct * barWidth);
  const empty  = barWidth - filled;

  const fillColor = pct > 0.85 ? chalk.red : pct > 0.65 ? chalk.yellow : chalk.hex('#a78bfa');
  const bar = fillColor('▰'.repeat(filled)) + chalk.dim('▱'.repeat(empty));

  const pctLabel = Math.round(pct * 100) + '%';
  return `${bar} ${chalk.white(current.toLocaleString())}${chalk.dim(' / ' + total.toLocaleString() + ' (' + pctLabel + ')')}`; 
}

// ─── Task-Aware Verb Builder ──────────────────────────────────────────────────
//
// If a file path / detail is known, make the verb specific:
//   "Reading…"   → "Reading auth.ts…"
//   "Writing…"   → "Writing Button.tsx…"
//   "Searching…" → "Searching useAuth…"

function buildVerbWithDetail(status, detail = '') {
  const base = pickVerb(status);
  if (!detail) return base + '…';

  const clean = detail.replace(/\\/g, '/').trim();
  let short = clean.split('/').pop() || clean; // basename only
  if (short.length > 28) short = short.slice(0, 27) + '…';
  return `${base} ${short}…`;
}

// ─── Main Spinner Class ───────────────────────────────────────────────────────

class RxsSpinner {
  /**
   * @param {string} status  — spinner key (thinking | streaming | tool_read | …)
   * @param {string} detail  — optional context (file path, query) for task-aware verb
   */
  constructor(status = 'streaming', detail = '') {
    this.status       = status;
    this.verb         = buildVerbWithDetail(status, detail);
    this.frameIdx     = 0;
    this.startedAt    = Date.now();
    this.lastTokenAt  = Date.now();
    this.isThinking   = status === 'thinking';
    this.isRunning    = false;
    this._interval    = null;
    this._lastLine    = '';
  }

  // Call this every time a new token arrives (for stall detection)
  notifyToken() {
    this.lastTokenAt = Date.now();
  }

  // Change verb mid-flight (task-aware updates)
  setVerb(newVerb) {
    this.verb = newVerb.endsWith('…') ? newVerb : newVerb + '…';
  }

  // Update status label (non-verb text shown after the verb)
  setStatus(text) {
    this._statusText = text;
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;

    if (prefersReducedMotion) {
      process.stdout.write('  ' + chalk.dim('…') + '\n');
      return;
    }

    this._render();
    this._interval = setInterval(() => {
      this.frameIdx = (this.frameIdx + 1) % SPINNER_FRAMES.length;
      this._render();
    }, 50);
  }

  _render() {
    const now     = Date.now();
    const elapsed = now - this.startedAt;
    const stalled = (now - this.lastTokenAt) > 3000 && !this.isThinking;

    const frames = stalled ? STALL_FRAMES : SPINNER_FRAMES;
    const frame  = stalled
      ? chalk.red(STALL_FRAMES[this.frameIdx % STALL_FRAMES.length])
      : chalk.hex('#a78bfa')(SPINNER_FRAMES[this.frameIdx]);

    const glimmerPos = computeGlimmerIndex(elapsed, this.verb.length);
    const verbText   = renderShimmerVerb(this.verb, glimmerPos, stalled);

    // Optional right-aligned status text (e.g., "3 in background")
    const suffix = this._statusText
      ? '  ' + chalk.dim(this._statusText)
      : '';

    const line = `  ${frame} ${verbText}${suffix}`;

    // Only redraw if line changed (avoid flicker)
    process.stdout.write('\r\x1b[K' + line);
    this._lastLine = line;
  }

  stop(opts = {}) {
    if (!this.isRunning) return;
    this.isRunning = false;

    if (this._interval) {
      clearInterval(this._interval);
      this._interval = null;
    }

    // Clear spinner line
    process.stdout.write('\r\x1b[K');

    // Thinking mode: print duration
    if (this.isThinking && opts.printDuration !== false) {
      const secs = Math.round((Date.now() - this.startedAt) / 1000);
      if (secs >= 1) {
        process.stdout.write(chalk.dim(`  thought for ${secs}s\n`));
      }
    }
  }
}

// ─── Singleton Management ─────────────────────────────────────────────────────

let _active = null;

export function createSpinner(status = 'streaming', detail = '') {
  // Always kill any existing spinner first
  stopActiveSpinner();

  const sp = new RxsSpinner(status, detail);
  sp.start();
  _active = sp;

  return {
    stop:         (opts)    => { sp.stop(opts);           _active = null; },
    update:       (text)    => sp.setVerb(text),
    setStatus:    (text)    => sp.setStatus(text),
    notifyToken:  ()        => sp.notifyToken(),
  };
}

export function stopActiveSpinner() {
  if (_active) {
    try { _active.stop({ printDuration: false }); } catch {}
    _active = null;
  }
}

// Notify active spinner that a token arrived (call from stream intercept)
export function notifyActiveSpinnerToken() {
  if (_active) _active.notifyToken();
}
