// Rough token estimate: 4 chars = 1 token
export function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

export function truncateToBudget(history, maxTokens, systemPromptTokens) {
  let available = maxTokens - systemPromptTokens;
  const truncated = [];

  // Fix: spread copy before reverse — never mutate the original history array
  for (const msg of [...history].reverse()) {
    const msgTokens = estimateTokens(JSON.stringify(msg));
    if (available - msgTokens < 0) break;
    truncated.unshift(msg);
    available -= msgTokens;
  }

  return truncated;
}
