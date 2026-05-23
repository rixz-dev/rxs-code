// ─── Ask User Tool ────────────────────────────────────────────────────────────
//
// When the AI calls this, the CLI intercepts it before execution,
// prompts the human directly via readline, and injects the answer
// back as a tool result. The AI never needs to "pretend" an answer.
//
// The CLI detects __ASK_USER__ prefix in the result and handles it specially.

export const askUserTools = [
  {
    type: 'function',
    function: {
      name: 'ask_user',
      description: [
        'Ask the user a clarifying question and WAIT for their answer before proceeding.',
        'Use this when you genuinely cannot proceed without more information.',
        'Keep questions short and specific — one question at a time.',
        'Do NOT use this for things you can reasonably infer or for trivial choices.',
        'Examples of GOOD use:',
        '  • "Should I overwrite existing tests or append new ones?"',
        '  • "Which database — PostgreSQL or SQLite?"',
        '  • "The API key is missing from .env. Where should I look for it?"',
      ].join('\n'),
      parameters: {
        type: 'object',
        properties: {
          question: {
            type: 'string',
            description: 'The question to ask the user (keep it focused and short)',
          },
          options: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional list of suggested answers (user can also type freely)',
          },
        },
        required: ['question'],
      },
    },
  },
];

// Special sentinel the CLI loop looks for
export const ASK_USER_SENTINEL = '__ASK_USER__:';

// Handler — returns the sentinel so CLI can intercept
export async function handleAskUserTool(args) {
  const { question, options } = args;
  if (!question) throw new Error('ask_user requires a question');
  // Encode question + options as JSON after the sentinel
  return `${ASK_USER_SENTINEL}${JSON.stringify({ question, options: options || [] })}`;
}
