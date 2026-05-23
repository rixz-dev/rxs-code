/**
 * ContextManager — 3-layer context compression
 *
 * Layer 1: MicroCompact  — hapus content tool result lama (per-turn, no API call)
 * Layer 2: AutoCompact   — summarize via sub-agent kalau context hampir penuh
 * Layer 3: ReactiveCompact — triggered saat API return 413/prompt_too_long
 */

import fs from 'fs/promises';
import { resolve } from 'path';

// ─── Constants ────────────────────────────────────────────────────────────────

// Tools yang hasil-nya bisa di-clear kalau sudah lama
const COMPACTABLE_TOOLS = new Set([
  'read_file', 'write_file', 'edit_file', 'create_file',
  'execute_command', 'search_codebase', 'glob',
  'web_search', 'web_fetch',
]);

const CLEARED_STUB = '[Tool result cleared — context compacted]';

// Threshold: berapa char di messages sebelum autocompact trigger
// Rough: 1 char ≈ 0.25 token, model 200k ctx ≈ 800k chars
// Trigger di 70% → 560k chars
export const AUTOCOMPACT_THRESHOLD_CHARS   = 560_000;
export const MICROCOMPACT_TARGET_CHARS     = 320_000; // target setelah micro
export const AUTOCOMPACT_WARNING_CHARS     = 480_000;

// ─── MicroCompact ─────────────────────────────────────────────────────────────

/**
 * Layer 1: Scan messages, clear content dari tool results lama.
 * Keep N most-recent tool results per tool name intact.
 * Jalan setiap turn, zero API calls.
 */
export function microCompactMessages(messages, opts = {}) {
  const KEEP_RECENT_PER_TOOL = opts.keepRecentPerTool || 2;

  // Count total chars dulu
  const totalChars = JSON.stringify(messages).length;
  if (totalChars < MICROCOMPACT_TARGET_CHARS) {
    return { messages, freed: 0, compacted: false };
  }

  // Track berapa recent results kita sudah keep per tool
  const recentCounts = {};
  let freed = 0;

  // Walk backwards agar "recent" adalah yang paling baru
  const reversed = [...messages].reverse();
  const result   = reversed.map(msg => {
    if (msg.role !== 'tool') return msg;

    // Cari tool name dari pesan assistant sebelumnya
    // msg.tool_call_id → cari di toolCallNames map
    const content = String(msg.content || '');
    if (content.length < 200) return msg; // terlalu kecil, skip

    // Infer tool dari content pattern
    const toolKey = inferToolFromContent(content) || 'unknown';
    recentCounts[toolKey] = (recentCounts[toolKey] || 0) + 1;

    if (recentCounts[toolKey] > KEEP_RECENT_PER_TOOL) {
      freed += content.length;
      return { ...msg, content: CLEARED_STUB };
    }
    return msg;
  });

  return {
    messages: result.reverse(),
    freed,
    compacted: freed > 0,
  };
}

function inferToolFromContent(content) {
  if (content.includes('lines,') && content.includes(' chars')) return 'write_file';
  if (content.includes('files matched') || content.includes('.js\n') || content.includes('.ts\n')) return 'glob';
  if (content.includes('$ ') || content.includes('npm') || content.includes('node')) return 'execute_command';
  if (content.includes('http') || content.includes('<html')) return 'web_fetch';
  if (content.includes('matches found') || content.includes('grep')) return 'search';
  return 'read_file'; // default
}

// ─── AutoCompact ──────────────────────────────────────────────────────────────

/**
 * Layer 2: Summarize whole conversation via a separate API call.
 * Returns new messages array: [summary_system_msg, ...recent_messages]
 */
export async function autoCompactMessages(messages, provider, model) {
  // Build history as readable text for summarizer
  const historyText = messages
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => {
      const role    = m.role === 'user' ? 'USER' : 'ASSISTANT';
      const content = typeof m.content === 'string'
        ? m.content.slice(0, 2000)
        : JSON.stringify(m.content).slice(0, 2000);
      return `[${role}]\n${content}`;
    })
    .join('\n\n---\n\n');

  const summaryPrompt = `You are summarizing a coding session for context compression.

Produce a DENSE, TECHNICAL summary that preserves:
1. What the user is building (project, stack, architecture)
2. What has been implemented / changed (files modified, functions added, bugs fixed)
3. Current state of work — what step we're on, what's pending
4. Any errors encountered and their solutions
5. Key decisions made (library choices, patterns used, etc.)
6. Files that exist and their purposes (brief)

Format as structured markdown. Be concise but complete — this replaces the full history.
Do NOT include generic instructions, just the factual summary.

CONVERSATION TO SUMMARIZE:
${historyText}`;

  try {
    // Use a lightweight/fast call for summary
    const summaryParams = {
      model,
      messages: [{ role: 'user', content: summaryPrompt }],
      maxTokens: 2000,
    };

    let summary = '';
    for await (const chunk of provider.stream(summaryParams)) {
      if (chunk.type === 'text') summary += chunk.content;
    }

    if (!summary.trim()) throw new Error('Empty summary');

    // Build compact message set: system summary + last few turns
    const KEEP_LAST_TURNS = 6;
    const recentMessages = messages.slice(-KEEP_LAST_TURNS * 2);

    const compactSystemMsg = {
      role: 'system',
      content: `[CONVERSATION COMPACTED — SESSION SUMMARY]\n\n${summary}\n\n[END SUMMARY — Continue from this context]`,
    };

    return {
      messages: [compactSystemMsg, ...recentMessages],
      summary,
      originalLength: messages.length,
    };
  } catch (e) {
    // Compact failed — return original, caller will handle
    throw new Error(`AutoCompact failed: ${e.message}`);
  }
}

// ─── Context Size Estimator ───────────────────────────────────────────────────

export function estimateContextChars(messages) {
  return JSON.stringify(messages).length;
}

export function getContextWarningState(chars) {
  return {
    chars,
    isAboveWarning:      chars > AUTOCOMPACT_WARNING_CHARS,
    isAboveThreshold:    chars > AUTOCOMPACT_THRESHOLD_CHARS,
    percentUsed:         Math.round((chars / AUTOCOMPACT_THRESHOLD_CHARS) * 100),
  };
}
