import OpenAI from 'openai';
import { BaseProvider } from './base.js';

/**
 * Gemini via OpenAI-compatible API:
 *   https://generativelanguage.googleapis.com/v1beta/openai/
 *
 * Thinking: via reasoning_effort ('low'|'medium'|'high')
 * - gemini-2.5-flash: bisa disable thinking (reasoning_effort: 'none')
 * - gemini-2.5-pro + gemini-3.x: TIDAK bisa disable, hanya bisa control level
 *
 * Models aktif per Mei 2026:
 *   gemini-2.5-flash, gemini-2.5-pro, gemini-3-flash-preview
 *   (gemini-3-pro-preview DEAD sejak 9 March 2026)
 */
export class GeminiProvider extends BaseProvider {
  constructor(config) {
    super(config);
    this.name = 'gemini';
    this.baseUrl = 'https://generativelanguage.googleapis.com/v1beta/openai/';
    this.supportsThinking = true;
    this.supportsToolCalling = true;
    this.defaultModel = 'gemini-2.5-flash';

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
    if (!this.config.apiKey) throw new Error('GEMINI_API_KEY not set');
    try {
      await this.client.models.list();
      return true;
    } catch (e) {
      if (e.status === 401 || e.status === 403) throw new Error('Invalid Gemini API key');
      if (e.status === 429 || e.status === 503) return true; // quota/overload = key valid
      throw new Error(`Gemini validation error: ${e.message}`);
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
    this._applyThinking(params, model || this.defaultModel, thinking);

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
    this._applyThinking(params, model || this.defaultModel, thinking);

    // Error dilempar langsung ke streamWithAutoContinue di cli.js
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
        yield { type: 'text', content: '[Empty response — try /thinking off]' };
      }
    }

    const finalToolCalls = Object.values(toolCallBuffer).filter(tc => tc.function.name);
    if (finalToolCalls.length) {
      yield { type: 'tool_calls', content: finalToolCalls, fullContent };
    }
  }

  async listModels() {
    // Gemini OpenAI compat /models returns aktif models
    try {
      const response = await this.client.models.list();
      if (response?.data?.length) {
        return response.data.map(m => ({
          id: m.id,
          owned_by: 'google',
          contextWindow: this._getContextWindow(m.id),
        }));
      }
    } catch {}
    // Fallback ke recommended list
    return this.getRecommendedModels().map(id => ({
      id, owned_by: 'google', contextWindow: this._getContextWindow(id),
    }));
  }

  getRecommendedModels() {
    return [
      'gemini-2.5-flash',             // default — fast, 1M ctx, free tier
      'gemini-2.5-pro',               // powerful, 1M ctx
      'gemini-3-flash-preview',       // newest fast model
    ];
  }

  getSystemPromptAppendix() {
    return `\n## GEMINI PROVIDER\nRunning on Google Gemini via OpenAI-compatible API. Model: ${this.defaultModel}. 1M token context. Thinking via reasoning_effort.`;
  }

  /**
   * Apply thinking params berdasarkan model dan level.
   * - Flash models: bisa disable (reasoning_effort: 'none')
   * - Pro + Gemini 3: tidak bisa disable, minimum 'low'
   */
  _applyThinking(params, model, thinkingLevel) {
    const isFlash = /flash|lite/i.test(model);

    if (!thinkingLevel || thinkingLevel === 'off') {
      if (isFlash) {
        params.reasoning_effort = 'none'; // disable thinking pada flash
      }
      // Pro/Gemini3: tidak set apa-apa = default model thinking level
      return;
    }

    const effortMap = { low: 'low', medium: 'medium', high: 'high', max: 'high' };
    params.reasoning_effort = effortMap[thinkingLevel] || 'medium';
  }

  _getContextWindow(modelId) {
    if (/2\.5|3/i.test(modelId)) return 1_000_000;
    return 128_000;
  }
}
