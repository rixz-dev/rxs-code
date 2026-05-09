import OpenAI from 'openai';
import { BaseProvider } from './base.js';

export class OpenRouterProvider extends BaseProvider {
  constructor(config) {
    super(config);
    this.name = 'openrouter';
    this.baseUrl = 'https://openrouter.ai/api/v1';
    this.supportsThinking = true;   // via reasoning_effort, model-dependent
    this.supportsToolCalling = true; // model-dependent — filter via /models
    this.defaultModel = 'google/gemini-2.5-flash';

    if (config.apiKey) {
      this.client = new OpenAI({
        apiKey: config.apiKey,
        baseURL: this.baseUrl,
        // Header opsional — untuk OpenRouter leaderboard/analytics
        defaultHeaders: {
          'HTTP-Referer': 'https://github.com/rxs-code',
          'X-Title': 'RXS Code',
        },
        timeout: 10 * 60 * 1000,
        maxRetries: 0, // kita handle retry sendiri
      });
    }
  }

  async validate() {
    if (!this.config.apiKey) throw new Error('OPENROUTER_API_KEY not set');
    try {
      await this.client.models.list();
      return true;
    } catch (e) {
      if (e.status === 401) throw new Error('Invalid OpenRouter API key');
      if (e.status === 429) return true; // rate limit = key valid
      throw new Error(`OpenRouter error: ${e.message}`);
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

    // OpenRouter pass-through — error langsung dilempar ke streamWithAutoContinue
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
        yield { type: 'text', content: '[Empty response — model might not support tools, try without]' };
      }
    }

    const finalToolCalls = Object.values(toolCallBuffer).filter(tc => tc.function.name);
    if (finalToolCalls.length) {
      yield { type: 'tool_calls', content: finalToolCalls, fullContent };
    }
  }

  async listModels() {
    try {
      // OpenRouter /models returns {data: [{id, context_length, ...}]}
      // Format beda dari OpenAI — parse manual
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          'HTTP-Referer': 'https://github.com/rxs-code',
        },
      });
      const data = await response.json();
      return (data.data || []).map(m => ({
        id: m.id,
        owned_by: m.id.split('/')[0] || 'openrouter',
        contextWindow: m.context_length || null,
      }));
    } catch {
      return this.getRecommendedModels().map(id => ({
        id, owned_by: id.split('/')[0], contextWindow: null,
      }));
    }
  }

  getRecommendedModels() {
    return [
      'google/gemini-2.5-flash',       // fast, cheap, 1M ctx
      'google/gemini-2.5-pro',          // powerful
      'anthropic/claude-sonnet-4-6',    // best coding
      'deepseek/deepseek-r1-0528',      // open source reasoning
      'moonshotai/kimi-k2',             // strong coder
      'qwen/qwen3-235b-a22b',           // qwen3 large
      'openai/gpt-4.1',                 // gpt
      'meta-llama/llama-4-maverick',    // llama4
      'openrouter/auto',                // auto-route best model
    ];
  }

  getSystemPromptAppendix() {
    return `\n## OPENROUTER PROVIDER\nRouting via OpenRouter — access to 500+ models. Current: ${this.defaultModel}. Tool calling varies by model.`;
  }

  _thinkingToEffort(level) {
    const map = { low: 'low', medium: 'medium', high: 'high', max: 'high' };
    return map[level] || 'medium';
  }
}
