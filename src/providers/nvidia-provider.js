import OpenAI from 'openai';
import { BaseProvider } from './base.js';

export class NvidiaNimProvider extends BaseProvider {
  constructor(config) {
    super(config);
    this.name = 'nvidia';
    this.baseUrl = 'https://integrate.api.nvidia.com/v1';
    this.supportsThinking = true;
    this.supportsToolCalling = true;
    this.defaultModel = 'qwen/qwen3-coder-480b-a35b-instruct';

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
    if (!this.config.apiKey) throw new Error('NVIDIA_NIM_API_KEY not set');
    try {
      await this.client.models.list();
      return true;
    } catch (e) {
      if (e.status === 401) throw new Error('Invalid NVIDIA API key');
      if (e.status === 429) return true;
      throw new Error(`NVIDIA error: ${e.message}`);
    }
  }

  async chat({ messages, tools, model, temperature = 0.7, maxTokens = 4096 }) {
    const params = { model: model || this.defaultModel, messages, temperature, max_tokens: maxTokens };
    if (tools?.length) { params.tools = tools; params.tool_choice = 'auto'; }
    const completion = await this.client.chat.completions.create(params);
    const choice = completion.choices[0];
    return { content: choice.message.content || '', toolCalls: choice.message.tool_calls || [], finishReason: choice.finish_reason };
  }

  async *stream({ messages, tools, model, temperature = 0.7, maxTokens = 4096, thinking }) {
    const params = { model: model || this.defaultModel, messages, temperature, max_tokens: maxTokens, stream: true };
    if (tools?.length) { params.tools = tools; params.tool_choice = 'auto'; }

    const thinkingKwargs = this._getThinkingKwargs(model || this.defaultModel, thinking);
    if (Object.keys(thinkingKwargs).length) {
      params.chat_template_kwargs = thinkingKwargs;
    } else if (/qwen3/i.test(model || this.defaultModel)) {
      params.chat_template_kwargs = { enable_thinking: false };
    }

    const stream = await this.client.chat.completions.create(params);
    const toolCallBuffer = {};
    let fullContent = '';
    let hasContent = false;

    let inThink = false;
    const stripThink = (raw) => {
      let out = '', i = 0;
      while (i < raw.length) {
        if (inThink) {
          const end = raw.indexOf('</think>', i);
          if (end !== -1) { inThink = false; i = end + 8; } else break;
        } else {
          const start = raw.indexOf('<think>', i);
          if (start !== -1) { out += raw.slice(i, start); inThink = true; i = start + 7; }
          else { out += raw.slice(i); break; }
        }
      }
      return out;
    };

    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta;
      if (delta?.content) {
        const clean = stripThink(delta.content);
        if (clean) { fullContent += clean; hasContent = true; yield { type: 'text', content: clean }; }
      }
      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index;
          if (!toolCallBuffer[idx]) toolCallBuffer[idx] = { id: tc.id || '', type: 'function', function: { name: '', arguments: '' } };
          if (tc.function?.name) toolCallBuffer[idx].function.name += tc.function.name;
          if (tc.function?.arguments) toolCallBuffer[idx].function.arguments += tc.function.arguments;
        }
      }
      if (chunk.choices?.[0]?.finish_reason === 'stop' && !hasContent) {
        yield { type: 'text', content: '[Empty response — try /thinking off or switch model]' };
      }
    }

    const finalToolCalls = Object.values(toolCallBuffer).filter(tc => tc.function.name);
    if (finalToolCalls.length) yield { type: 'tool_calls', content: finalToolCalls, fullContent };
  }

  async listModels() {
    try {
      const response = await this.client.models.list();
      return response.data.map(m => ({ id: m.id, owned_by: m.owned_by || 'nvidia', contextWindow: m.context_window || null }));
    } catch {
      return this.getRecommendedModels().map(id => ({ id, owned_by: 'nvidia', contextWindow: null }));
    }
  }

  getRecommendedModels() {
    return [
      'qwen/qwen3-coder-480b-a35b-instruct',
      'nvidia/llama-3.1-nemotron-ultra-253b-v1',
      'deepseek-ai/deepseek-r1-0528',
      'moonshotai/kimi-k2-instruct',
      'nvidia/llama-3.3-nemotron-super-49b-v1',
    ];
  }

  getSystemPromptAppendix() {
    return `\n## NVIDIA NIM\nModel: ${this.defaultModel}. Tool calling: Llama 3+ dan Qwen3 Coder.`;
  }

  _getThinkingKwargs(model, thinkingLevel) {
    if (!thinkingLevel || thinkingLevel === 'off') return {};
    if (!/qwen3/i.test(model)) return {};
    const budgetMap = { low: 1024, medium: 4096, high: 8192, max: 16384 };
    return { enable_thinking: true, thinking_budget: budgetMap[thinkingLevel] || 4096 };
  }
}
