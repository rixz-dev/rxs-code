import OpenAI from 'openai';
import { BaseProvider } from './base.js';

export class TogetherProvider extends BaseProvider {
  constructor(config) {
    super(config);
    this.name = 'together';
    this.baseUrl = 'https://api.together.xyz/v1';
    this.supportsThinking = true;   // DeepSeek-R1, Qwen3 thinking tersedia
    this.supportsToolCalling = true;
    this.defaultModel = 'deepseek-ai/DeepSeek-V3';

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
    if (!this.config.apiKey) throw new Error('TOGETHER_API_KEY not set');
    try {
      await this.client.models.list();
      return true;
    } catch (e) {
      if (e.status === 401) throw new Error('Invalid Together AI API key');
      if (e.status === 429) return true;
      throw new Error(`Together AI error: ${e.message}`);
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
    const completion = await this.client.chat.completions.create(params);
    const choice = completion.choices[0];
    const raw = choice.message.content || '';
    return {
      content: this._stripThinkTags(raw),
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

    const stream = await this.client.chat.completions.create(params);
    const toolCallBuffer = {};
    let fullContent = '';
    let hasContent = false;

    // Together AI: DeepSeek-R1 emit <think> tags, perlu di-strip
    let thinkBuffer = '';
    let insideThink = false;

    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta;

      if (delta?.content) {
        let raw = delta.content;

        if (insideThink) {
          thinkBuffer += raw;
          const closeIdx = thinkBuffer.indexOf('</think>');
          if (closeIdx !== -1) {
            insideThink = false;
            raw = thinkBuffer.slice(closeIdx + 8);
            thinkBuffer = '';
          } else {
            yield { type: 'thinking', content: raw };
            continue;
          }
        } else if (raw.includes('<think>')) {
          const openIdx = raw.indexOf('<think>');
          const before = raw.slice(0, openIdx);
          const after = raw.slice(openIdx + 7);

          if (before) {
            fullContent += before;
            hasContent = true;
            yield { type: 'text', content: before };
          }

          const closeIdx = after.indexOf('</think>');
          if (closeIdx !== -1) {
            raw = after.slice(closeIdx + 8);
          } else {
            insideThink = true;
            thinkBuffer = after;
            yield { type: 'thinking_start' };
            continue;
          }
        }

        if (raw) {
          fullContent += raw;
          hasContent = true;
          yield { type: 'text', content: raw };
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

      if (chunk.choices?.[0]?.finish_reason === 'stop' && !hasContent) {
        yield { type: 'text', content: '[Empty response from Together AI]' };
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
        owned_by: m.id.split('/')[0] || 'together',
        contextWindow: null,
      }));
    } catch {
      return this.getRecommendedModels().map(id => ({
        id, owned_by: id.split('/')[0], contextWindow: null,
      }));
    }
  }

  getRecommendedModels() {
    return [
      'deepseek-ai/DeepSeek-V3',                      // default, best for coding
      'deepseek-ai/DeepSeek-R1',                      // best reasoning OSS
      'deepseek-ai/DeepSeek-R1-Distill-Llama-70B',   // R1 distill, faster
      'meta-llama/Llama-3.3-70B-Instruct-Turbo',     // Llama turbo
      'meta-llama/Meta-Llama-3.1-405B-Instruct-Turbo', // largest Llama
      'Qwen/Qwen3-235B-A22B',                         // Qwen3 MoE
      'Qwen/Qwen3-72B',                               // Qwen3 dense
      'mistralai/Mistral-7B-Instruct-v0.3',           // cheap & fast
      'codellama/CodeLlama-70b-Instruct-hf',          // code-specific
    ];
  }

  getSystemPromptAppendix() {
    return `\n## TOGETHER AI PROVIDER\nLargest OSS model catalog — DeepSeek, Llama, Qwen, Mistral. ~$100 signup credits. Model: ${this.defaultModel}.`;
  }

  _stripThinkTags(text) {
    return text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  }
}
