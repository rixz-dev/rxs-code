/**
 * TokenBudget — user bisa set "+500k" atau "use 2M tokens"
 * dan AI terus kerja tanpa diminta sampai budget habis.
 *
 * Juga: max_output_tokens recovery — kalau AI kepotong di tengah,
 * inject "Resume directly" message sampai 3x sebelum menyerah.
 */

// ─── Budget Parser ────────────────────────────────────────────────────────────

// Regex sama persis dengan Claude Code
const SHORTHAND_START_RE = /^\s*\+(\d+(?:\.\d+)?)\s*(k|m|b)\b/i;
const SHORTHAND_END_RE   = /\s\+(\d+(?:\.\d+)?)\s*(k|m|b)\s*[.!?]?\s*$/i;
const VERBOSE_RE         = /\b(?:use|spend)\s+(\d+(?:\.\d+)?)\s*(k|m|b)\s*tokens?\b/i;

const MULTIPLIERS = { k: 1_000, m: 1_000_000, b: 1_000_000_000 };

function parseBudgetMatch(value, suffix) {
  return parseFloat(value) * (MULTIPLIERS[suffix.toLowerCase()] || 1);
}

/**
 * Parse token budget from user input.
 * Returns token count number, or null if no budget found.
 *
 * Examples:
 *   "+500k"          → 500000
 *   "+2m tokens"     → 2000000
 *   "use 1m tokens"  → 1000000
 *   "spend 500k"     → 500000
 */
export function parseTokenBudget(text) {
  const m1 = text.match(SHORTHAND_START_RE);
  if (m1) return parseBudgetMatch(m1[1], m1[2]);

  const m2 = text.match(SHORTHAND_END_RE);
  if (m2) return parseBudgetMatch(m2[1], m2[2]);

  const m3 = text.match(VERBOSE_RE);
  if (m3) return parseBudgetMatch(m3[1], m3[2]);

  return null;
}

// ─── BudgetTracker ────────────────────────────────────────────────────────────

export class BudgetTracker {
  constructor(budget) {
    this.budget              = budget;        // total token budget user set
    this.continuationCount   = 0;             // berapa kali udah lanjut
    this.lastOutputLength    = 0;             // panjang output iterasi sebelumnya
    this.startedAt           = Date.now();
    this.totalOutputChars    = 0;
  }

  // Rough 1 token ≈ 4 chars
  get estimatedTokensUsed() {
    return Math.round(this.totalOutputChars / 4);
  }

  get pct() {
    return Math.min(100, Math.round((this.estimatedTokensUsed / this.budget) * 100));
  }

  /**
   * After each AI response, check if we should continue.
   * Returns: { action: 'continue' | 'stop', nudgeMessage?, reason? }
   */
  check(newOutputChars) {
    const delta = newOutputChars - this.lastOutputLength;
    this.totalOutputChars  += Math.max(0, delta);
    this.lastOutputLength   = newOutputChars;

    const used  = this.estimatedTokensUsed;
    const pct   = this.pct;
    const fmt   = n => new Intl.NumberFormat('en-US').format(n);

    // Diminishing returns check: 3+ continuations AND last 2 barely produced anything
    const DIMINISHING_THRESHOLD_CHARS = 500 * 4; // ~500 tokens * 4 chars
    const isDiminishing =
      this.continuationCount >= 3 &&
      delta < DIMINISHING_THRESHOLD_CHARS;

    // Budget exhausted
    if (isDiminishing || used >= this.budget) {
      return {
        action: 'stop',
        reason: isDiminishing ? 'diminishing_returns' : 'budget_exhausted',
        stats: { continuationCount: this.continuationCount, pct, durationMs: Date.now() - this.startedAt },
      };
    }

    // Under 90% of budget → keep going
    if (used < this.budget * 0.9) {
      this.continuationCount++;
      return {
        action: 'continue',
        nudgeMessage:
          `Stopped at ${pct}% of token target (${fmt(used)} / ${fmt(this.budget)}). ` +
          `Keep working — do not summarize.`,
      };
    }

    return { action: 'stop', reason: 'threshold_reached' };
  }
}

// ─── Max Output Tokens Recovery ───────────────────────────────────────────────

export const MAX_OUTPUT_TOKENS_RECOVERY_LIMIT = 3;

/**
 * Detect if an error is a max_output_tokens cutoff
 * (finish_reason === 'length' in OpenAI-compat APIs)
 */
export function isMaxOutputTokensCutoff(err, finishReason) {
  if (finishReason === 'length' || finishReason === 'max_tokens') return true;
  if (!err) return false;
  const msg = (err.message || '').toLowerCase();
  return (
    msg.includes('max_output_tokens') ||
    msg.includes('output token limit') ||
    msg.includes('maximum context length') ||
    msg.includes('context window')
  );
}

/**
 * Build the recovery message to inject after max_output_tokens cutoff.
 * Exact wording from Claude Code source.
 */
export function buildRecoveryMessage(attempt) {
  return (
    `Output token limit hit. Resume directly — no apology, no recap of what you were doing. ` +
    `Pick up mid-thought if that is where the cut happened. ` +
    `Break remaining work into smaller pieces.` +
    (attempt > 1 ? ` (recovery attempt ${attempt}/${MAX_OUTPUT_TOKENS_RECOVERY_LIMIT})` : '')
  );
}

// ─── Budget status formatter ──────────────────────────────────────────────────

export function formatBudgetStatus(tracker) {
  const pct = tracker.pct;
  const bar = '█'.repeat(Math.floor(pct / 10)) + '░'.repeat(10 - Math.floor(pct / 10));
  const fmt = n => new Intl.NumberFormat('en-US').format(n);
  return `[${bar}] ${pct}%  ${fmt(tracker.estimatedTokensUsed)} / ${fmt(tracker.budget)} tokens`;
}
