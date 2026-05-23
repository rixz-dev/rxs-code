/**
 * compact.js — AI-powered conversation compaction
 * Summarizes history to free up context space (like Claude Code /compact)
 */

import { estimateTokens } from './tokenizer.js';

const COMPACT_SYSTEM = `You are a conversation summarizer for a terminal AI coding assistant called rxs-code.
Summarize the conversation below into a dense, structured memory block that preserves:
- Every file that was created, modified, or discussed (with paths)
- Every decision made and why
- Current state of any ongoing task or roadmap
- Key technical context (stack, environment, constraints)
- Any errors encountered and how they were resolved
- What the user was trying to accomplish

Format as compact bullet points. Be dense — every word counts. Omit pleasantries and filler.
Start with "## Compacted Memory" header.`;

/**
 * Compact conversation history via AI summarization
 * @param {Array} history - Full conversation history
 * @param {Object} provider - Active AI provider
 * @param {string} model - Active model ID
 * @returns {{ summary: string, tokensBefore: number, tokensAfter: number }}
 */
export async function compactHistory(history, provider, model) {
  if (!history?.length) throw new Error('Nothing to compact — history is empty');

  const serialized = history
    .map(m => `[${m.role.toUpperCase()}]\n${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`)
    .join('\n\n---\n\n');

  const tokensBefore = estimateTokens(serialized);

  // Call provider to summarize
  const params = {
    model,
    messages: [{ role: 'user', content: serialized }],
    system: COMPACT_SYSTEM,
    max_tokens: 2000,
    stream: false,
  };

  let summary = '';
  for await (const chunk of provider.stream(params)) {
    if (chunk.type === 'text') summary += chunk.text;
  }

  const tokensAfter = estimateTokens(summary);

  return { summary: summary.trim(), tokensBefore, tokensAfter };
}

/**
 * Check if compaction is recommended
 * @param {Array} history
 * @param {number} maxTokens
 * @returns {{ pct: number, shouldWarn: boolean, shouldAuto: boolean }}
 */
export function compactionStatus(history, maxTokens = 100000) {
  const est = estimateTokens(JSON.stringify(history || []));
  const pct = Math.round((est / maxTokens) * 100);
  return {
    pct,
    shouldWarn: pct >= 75,
    shouldAuto: pct >= 92,
    tokens: est,
    maxTokens,
  };
}
