import OpenAI from 'openai';
import { BaseProvider } from './base.js';

export class KimiProvider extends BaseProvider {
  constructor(config) {
    super(config);
    this.name = 'kimi';
    this.baseUrl = 'https://api.moonshot.ai/v1';
    this.supportsThinking = true;   // kimi-k2 supports thinking via `thinking` param
    this.supportsToolCalling = true;
    this.defaultModel = 'kimi-k2-5';

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
    if (!this.config.apiKey) throw new Error('KIMI_API_KEY not set');
    try {
      await this.client.models.list();
      return true;
    } catch (e) {
      if (e.status === 401) throw new Error('Invalid Kimi API key');
      if (e.status === 429) return true;
      throw new Error(`Kimi error: ${e.message}`);
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
    // Kimi supports extended thinking via extra_body
    if (thinking && thinking !== 'off') {
      params.extra_body = {
        thinking: { type: 'enabled', budget_tokens: this._thinkingBudget(thinking) },
      };
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
      params.extra_body = {
        thinking: { type: 'enabled', budget_tokens: this._thinkingBudget(thinking) },
      };
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
        yield { type: 'text', content: '[Empty response from Kimi]' };
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
        owned_by: 'moonshot',
        contextWindow: null,
      }));
    } catch {
      return this.getRecommendedModels().map(id => ({
        id, owned_by: 'moonshot', contextWindow: null,
      }));
    }
  }

  getRecommendedModels() {
    return [
      'kimi-k2-5',          // flagship, best coding
      'kimi-k1.5',          // reasoning-focused
      'moonshot-v1-128k',   // long context
      'moonshot-v1-32k',    // medium context
      'moonshot-v1-8k',     // fast, short tasks
    ];
  }

  getSystemPromptAppendix() {
    return `\n## KIMI PROVIDER (Moonshot AI)\nPowered by Moonshot AI — strong at coding, math, long-context tasks. Model: ${this.defaultModel}.`;
  }

  _thinkingBudget(level) {
    const map = { low: 2048, medium: 8192, high: 16384, max: 32768 };
    return map[level] || 8192;
  }
}
