import OpenAI from 'openai';
import { BaseProvider } from './base.js';

// Regional endpoint — Singapore untuk Asia/ID, US untuk global
const ENDPOINTS = {
  sg: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
  us: 'https://dashscope-us.aliyuncs.com/compatible-mode/v1',
  cn: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
};

export class QwenProvider extends BaseProvider {
  constructor(config) {
    super(config);
    this.name = 'qwen';
    // Default Singapore — paling dekat dari Indonesia
    const region = config.region || process.env.QWEN_REGION || 'sg';
    this.baseUrl = ENDPOINTS[region] || ENDPOINTS.sg;
    this.supportsThinking = true;   // qwen3 models support thinking
    this.supportsToolCalling = true;
    this.defaultModel = 'qwen3-coder-plus';

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
    if (!this.config.apiKey) throw new Error('QWEN_API_KEY not set');
    try {
      // Qwen /models endpoint
      await this.client.models.list();
      return true;
    } catch (e) {
      if (e.status === 401 || e.status === 403) throw new Error('Invalid Qwen API key');
      if (e.status === 429) return true;
      throw new Error(`Qwen error: ${e.message}`);
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
    // Qwen3 thinking: enable_thinking via extra_body
    if (thinking && thinking !== 'off') {
      params.extra_body = { enable_thinking: true };
    } else {
      // Explicit disable untuk non-thinking models biar ga error
      params.extra_body = { enable_thinking: false };
    }
    const completion = await this.client.chat.completions.create(params);
    const choice = completion.choices[0];
    // Qwen reasoning content bisa ada di reasoning_content field
    const content = choice.message.content || choice.message.reasoning_content || '';
    return {
      content,
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
      params.extra_body = { enable_thinking: true };
    } else {
      params.extra_body = { enable_thinking: false };
    }

    const stream = await this.client.chat.completions.create(params);
    const toolCallBuffer = {};
    let fullContent = '';
    let hasContent = false;
    let inThinking = false;

    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta;

      // Qwen3 reasoning_content — skip ke display tapi track buat context
      if (delta?.reasoning_content) {
        // Tampilkan thinking prefix sekali, lalu content
        if (!inThinking) {
          inThinking = true;
          yield { type: 'thinking_start' };
        }
        yield { type: 'thinking', content: delta.reasoning_content };
      }

      if (delta?.content) {
        if (inThinking) {
          inThinking = false;
          yield { type: 'thinking_end' };
        }
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
        yield { type: 'text', content: '[Empty response from Qwen]' };
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
        owned_by: 'alibaba',
        contextWindow: null,
      }));
    } catch {
      return this.getRecommendedModels().map(id => ({
        id, owned_by: 'alibaba', contextWindow: null,
      }));
    }
  }

  getRecommendedModels() {
    return [
      'qwen3-coder-plus',   // best for coding, 262K ctx
      'qwen3-235b-a22b',    // flagship MoE, strongest reasoning
      'qwen3-72b',          // dense 72B, balance speed/quality
      'qwen3-32b',          // compact, fast
      'qwen3-14b',          // lightweight
      'qwen3-8b',           // fastest
      'qwen-max',           // production alias
      'qwen-plus',          // cheaper alias
      'qwen-turbo',         // fastest alias
    ];
  }

  getSystemPromptAppendix() {
    return `\n## QWEN PROVIDER (Alibaba DashScope)\nPowered by Alibaba Cloud — strong at coding and multilingual tasks. Endpoint: ${this.baseUrl}. Model: ${this.defaultModel}.`;
  }
}
