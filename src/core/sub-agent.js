/**
 * SubAgent — runs isolated single-task completions.
 * Uses the active provider instance (not hardcoded GroqClient).
 *
 * Usage:
 *   const agent = new SubAgent(providerInstance);
 *   const result = await agent.execute({ task: '...', context: '...' });
 */
export class SubAgent {
  constructor(provider) {
    if (!provider) throw new Error('SubAgent requires a provider instance');
    this.provider = provider;
  }

  async execute({ task, context = '', systemPrompt = '', model = null }) {
    const baseSystem = `You are a sub-agent of RXS Code.
Complete this single task efficiently. Return only the result — no commentary, no conversation.

Task: ${task}
${systemPrompt}`.trim();

    const userContent = context
      ? `<context>\n${context}\n</context>\n\nComplete the task.`
      : 'Complete the task.';

    const messages = [
      { role: 'system', content: baseSystem },
      { role: 'user', content: userContent },
    ];

    try {
      let result = '';
      for await (const chunk of this.provider.stream({
        messages,
        model: model || this.provider.defaultModel,
        temperature: 0.3,
        maxTokens: 2000,
      })) {
        if (chunk.type === 'text') result += chunk.content;
      }
      return result.trim() || '(no output)';
    } catch (err) {
      return `Sub-agent error: ${err.message}`;
    }
  }
}
