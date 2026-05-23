import OpenAI from 'openai';
import { BaseProvider } from './base.js';

export class CerebrasProvider extends BaseProvider {
  constructor(config) {
    super(config);
    this.name = 'cerebras';
    this.baseUrl = 'https://api.cerebras.ai/v1';
    this.supportsThinking = false;  // Cerebras hosts OSS models, no native thinking API
    this.supportsToolCalling = true; // supported on Llama 3.3+
    this.defaultModel = 'llama-3.3-70b';

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
    if (!this.config.apiKey) throw new Error('CEREBRAS_API_KEY not set');
    try {
      await this.client.models.list();
      return true;
    } catch (e) {
      if (e.status === 401) throw new Error('Invalid Cerebras API key');
      if (e.status === 429) return true;
      throw new Error(`Cerebras error: ${e.message}`);
    }
  }

  async chat({ messages, tools, model, temperature = 0.7, maxTokens = 8000 }) {
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
    const completion = await this.client.chat.completions.create(params);
    const choice = completion.choices[0];
    return {
      content: choice.message.content || '',
      toolCalls: choice.message.tool_calls || [],
      finishReason: choice.finish_reason,
    };
  }

  async *stream({ messages, tools, model, temperature = 0.7, maxTokens = 8000 }) {
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
        yield { type: 'text', content: '[Empty response from Cerebras]' };
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
        owned_by: 'cerebras',
        contextWindow: null,
      }));
    } catch {
      return this.getRecommendedModels().map(id => ({
        id, owned_by: 'cerebras', contextWindow: null,
      }));
    }
  }

  getRecommendedModels() {
    return [
      'llama-3.3-70b',          // flagship — best quality, fast
      'llama3.1-8b',            // lightweight, blazing fast
      'qwen-3-32b',             // Qwen3 32B on WSE hardware
      'qwen-3-235b-a22b',       // Qwen3 235B MoE — huge but ~1400 t/s
      'gpt-oss-120b',           // OpenAI OSS 120B
      'llama-4-scout-17b-16e',  // Llama 4 Scout — ~2600 t/s
    ];
  }

  getSystemPromptAppendix() {
    return `\n## CEREBRAS PROVIDER\nPowered by Cerebras WSE-3 silicon — fastest inference available (~2600 tokens/sec). Free tier: 1M tokens/day. Context cap 8K on free tier. Model: ${this.defaultModel}.`;
  }
}
