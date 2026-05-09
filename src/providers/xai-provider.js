import OpenAI from 'openai';
import { BaseProvider } from './base.js';

export class XAIProvider extends BaseProvider {
  constructor(config) {
    super(config);
    this.name = 'xai';
    this.baseUrl = 'https://api.x.ai/v1';
    this.supportsThinking = true;   // Grok-4 supports reasoning/thinking mode
    this.supportsToolCalling = true;
    this.defaultModel = 'grok-4';

    if (config.apiKey) {
      this.client = new OpenAI({
        apiKey: config.apiKey,
        baseURL: this.baseUrl,
        timeout: 10 * 60 * 1000,
        maxRetries: 0,
      });
    }
  }

  async validate() {
    if (!this.config.apiKey) throw new Error('XAI_API_KEY not set');
    try {
      await this.client.models.list();
      return true;
    } catch (e) {
      if (e.status === 401) throw new Error('Invalid xAI API key');
      if (e.status === 429) return true;
      throw new Error(`xAI error: ${e.message}`);
    }
  }

  async chat({ messages, tools, model, temperature = 0.7, maxTokens = 8000, thinking }) {
    const params = {
      model: model || this.defaultModel,
      messages,
      temperature,
      max_tokens: maxTokens,
    };
    if (tools?.length) {
      params.tools = tools;
      params.tool_choice = 'auto';
    }
    // Grok thinking mode via reasoning_effort (same pattern as OpenRouter)
    if (thinking && thinking !== 'off') {
      params.reasoning_effort = this._thinkingToEffort(thinking);
    }
    const completion = await this.client.chat.completions.create(params);
    const choice = completion.choices[0];
    return {
      content: choice.message.content || '',
      toolCalls: choice.message.tool_calls || [],
      finishReason: choice.finish_reason,
    };
  }

  async *stream({ messages, tools, model, temperature = 0.7, maxTokens = 8000, thinking }) {
    const params = {
      model: model || this.defaultModel,
      messages,
      temperature,
      max_tokens: maxTokens,
      stream: true,
    };
    if (tools?.length) {
      params.tools = tools;
      params.tool_choice = 'auto';
    }
    if (thinking && thinking !== 'off') {
      params.reasoning_effort = this._thinkingToEffort(thinking);
    }

    const stream = await this.client.chat.completions.create(params);
    const toolCallBuffer = {};
    let fullContent = '';
    let hasContent = false;

    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta;
      if (delta?.content) {
        fullContent += delta.content;
        hasContent = true;
        yield { type: 'text', content: delta.content };
      }
      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index;
          if (!toolCallBuffer[idx]) {
            toolCallBuffer[idx] = { id: tc.id || '', type: 'function', function: { name: '', arguments: '' } };
          }
          if (tc.function?.name) toolCallBuffer[idx].function.name += tc.function.name;
          if (tc.function?.arguments) toolCallBuffer[idx].function.arguments += tc.function.arguments;
        }
      }
      if (chunk.choices?.[0]?.finish_reason === 'stop' && !hasContent) {
        yield { type: 'text', content: '[Empty response from xAI]' };
      }
    }

    const finalToolCalls = Object.values(toolCallBuffer).filter(tc => tc.function.name);
    if (finalToolCalls.length) {
      yield { type: 'tool_calls', content: finalToolCalls, fullContent };
    }
  }

  async listModels() {
    try {
      const resp = await this.client.models.list();
      return (resp.data || []).map(m => ({
        id: m.id,
        owned_by: 'xai',
        contextWindow: null,
      }));
    } catch {
      return this.getRecommendedModels().map(id => ({
        id, owned_by: 'xai', contextWindow: null,
      }));
    }
  }

  getRecommendedModels() {
    return [
      'grok-4',           // flagship, best reasoning
      'grok-4-fast',      // faster variant, 2M ctx
      'grok-3',           // previous gen, solid
      'grok-3-mini',      // cheap frontier — $0.30/$0.50 per MTok
      'grok-3-fast',      // speed-optimized
    ];
  }

  getSystemPromptAppendix() {
    return `\n## XAI PROVIDER (Grok)\nPowered by xAI — Grok-4 with 2M context window. $25 signup + $150/mo data-sharing credits. Model: ${this.defaultModel}.`;
  }

  _thinkingToEffort(level) {
    const map = { low: 'low', medium: 'medium', high: 'high', max: 'high' };
    return map[level] || 'medium';
  }
}
