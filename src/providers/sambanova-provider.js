import OpenAI from 'openai';
import { BaseProvider } from './base.js';

export class SambaNovProvider extends BaseProvider {
  constructor(config) {
    super(config);
    this.name = 'sambanova';
    this.baseUrl = 'https://api.sambanova.ai/v1';
    this.supportsThinking = true;  // DeepSeek-R1 & thinking models tersedia
    this.supportsToolCalling = true;
    this.defaultModel = 'Meta-Llama-3.3-70B-Instruct';

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
    if (!this.config.apiKey) throw new Error('SAMBANOVA_API_KEY not set');
    // SambaNova tidak punya /v1/models — test dengan minimal chat request
    try {
      await this.client.chat.completions.create({
        model: this.defaultModel,
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 1,
      });
      return true;
    } catch (e) {
      if (e.status === 401 || e.status === 403) throw new Error('Invalid SambaNova API key');
      if (e.status === 429) return true;
      // 400 dengan key valid = key valid, model mungkin beda
      if (e.status === 400) return true;
      throw new Error(`SambaNova error: ${e.message}`);
    }
  }

  async chat({ messages, tools, model, temperature = 0.7, maxTokens = 8000, thinking }) {
    const m = model || this.defaultModel;
    const params = {
      model: m,
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
    // DeepSeek-R1 di SambaNova bisa emit <think> tags — strip dari final content
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

    // State machine untuk strip <think> dari DeepSeek-R1 dan model thinking lainnya
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
            if (!hasContent) yield { type: 'thinking_start' };
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
        yield { type: 'text', content: '[Empty response from SambaNova]' };
      }
    }

    const finalToolCalls = Object.values(toolCallBuffer).filter(tc => tc.function.name);
    if (finalToolCalls.length) {
      yield { type: 'tool_calls', content: finalToolCalls, fullContent };
    }
  }

  // SambaNova tidak expose /v1/models — hardcode dari docs resmi
  async listModels() {
    return this.getRecommendedModels().map(id => ({
      id, owned_by: 'sambanova', contextWindow: null,
    }));
  }

  getRecommendedModels() {
    return [
      'Meta-Llama-3.3-70B-Instruct',    // default, kenceng & capable
      'Meta-Llama-3.1-405B-Instruct',   // largest, best quality
      'Meta-Llama-3.1-8B-Instruct',     // fastest
      'DeepSeek-V3.1',                  // DeepSeek V3 terbaru
      'DeepSeek-R1-0528',               // reasoning model terbaru
      'Qwen3-235B-A22B',                // Qwen3 MoE terbesar
      'Qwen3-32B',                      // Qwen3 compact
    ];
  }

  getSystemPromptAppendix() {
    return `\n## SAMBANOVA PROVIDER\nPowered by SambaNova RDU — fast inference on Llama, DeepSeek, Qwen. Free tier via email signup. Model: ${this.defaultModel}.`;
  }

  _stripThinkTags(text) {
    return text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  }
}
