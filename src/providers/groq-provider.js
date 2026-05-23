import Groq from 'groq-sdk';
import { BaseProvider } from './base.js';

export class GroqProvider extends BaseProvider {
  constructor(config) {
    super(config);
    this.name = 'groq';
    this.supportsThinking = false;   // Groq standard models: thinking off
    this.supportsToolCalling = true;
    this.defaultModel = 'llama-3.3-70b-versatile';

    if (config.apiKey) {
      this.client = new Groq({ apiKey: config.apiKey });
    }
  }

  async validate() {
    if (!this.config.apiKey) throw new Error('GROQ_API_KEY not set');
    try {
      const models = await this.client.models.list();
      return models.data?.length > 0;
    } catch {
      throw new Error('Invalid Groq API key or network error');
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

    // Tools hanya kalau model support — jangan pass ke model yang ga support
    const toolSupportedModels = ['llama', 'qwen', 'kimi', 'gpt-oss'];
    const modelId = (model || this.defaultModel).toLowerCase();
    const supportsTools = toolSupportedModels.some(m => modelId.includes(m));
    if (tools?.length && supportsTools) {
      params.tools = tools;
      params.tool_choice = 'auto';
    }

    try {
      const stream = await this.client.chat.completions.create(params);
      let toolCallBuffer = {};
      let fullContent = '';

      // Stateful think-tag stripper (sama dengan NVIDIA)
      let inThink = false;
      const stripThink = (raw) => {
        let out = '';
        let i = 0;
        while (i < raw.length) {
          if (inThink) {
            const end = raw.indexOf('</think>', i);
            if (end !== -1) { inThink = false; i = end + 8; }
            else break;
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
          if (clean) {
            fullContent += clean;
            yield { type: 'text', content: clean };
          }
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
      }

      const finalToolCalls = Object.values(toolCallBuffer).filter(tc => tc.function.name);
      if (finalToolCalls.length) {
        yield { type: 'tool_calls', content: finalToolCalls, fullContent };
      }
    } catch (err) {
      // Groq 400: model ga support tools — retry tanpa tools
      if (err.status === 400 && params.tools) {
        yield { type: 'text', content: '[Tool call gagal, retry tanpa tools...]\n' };
        delete params.tools;
        delete params.tool_choice;
        const stream2 = await this.client.chat.completions.create(params);
        for await (const chunk of stream2) {
          const delta = chunk.choices?.[0]?.delta;
          if (delta?.content) yield { type: 'text', content: delta.content };
        }
      } else {
        yield { type: 'text', content: `\nGroq Error: ${err.message}` };
      }
    }
  }

  async listModels() {
    try {
      const response = await this.client.models.list();
      return response.data.map(m => ({
        id: m.id,
        owned_by: m.owned_by || 'groq',
        contextWindow: m.context_window || null,
      }));
    } catch {
      return this.getRecommendedModels().map(id => ({ id, owned_by: 'groq', contextWindow: null }));
    }
  }

  getRecommendedModels() {
    return [
      'llama-3.3-70b-versatile',
      'llama-3.1-8b-instant',
      'qwen-3-32b',
      'moonshotai/kimi-k2-instruct',
      'meta-llama/llama-4-scout-17b-16e-instruct',
    ];
  }

  getSystemPromptAppendix() {
    return `\n## GROQ\nLPU inference. Model: ${this.defaultModel}. 128K context.`;
  }
}
