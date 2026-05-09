import OpenAI from 'openai';
import { BaseProvider } from './base.js';

// Regex untuk strip <think>...</think> dari streaming content
const THINK_TAG_RE = /<think>[\s\S]*?<\/think>/g;
const THINK_OPEN_RE = /<think>/;
const THINK_CLOSE_RE = /<\/think>/;

export class MiniMaxProvider extends BaseProvider {
  constructor(config) {
    super(config);
    this.name = 'minimax';
    this.baseUrl = 'https://api.minimax.io/v1';
    this.supportsThinking = true;
    this.supportsToolCalling = true;
    this.defaultModel = 'MiniMax-M1';

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
    if (!this.config.apiKey) throw new Error('MINIMAX_API_KEY not set');
    try {
      await this.client.models.list();
      return true;
    } catch (e) {
      if (e.status === 401 || e.status === 403) throw new Error('Invalid MiniMax API key');
      if (e.status === 429) return true;
      throw new Error(`MiniMax error: ${e.message}`);
    }
  }

  async chat({ messages, tools, model, temperature = 0.7, maxTokens = 8000, thinking }) {
    const params = {
      model: model || this.defaultModel,
      messages,
      temperature,
      max_tokens: maxTokens,
      // reasoning_split pisahkan thinking ke field terpisah — hindari contamination di content
      extra_body: { reasoning_split: true },
    };
    if (tools?.length) {
      params.tools = tools;
      params.tool_choice = 'auto';
    }
    const completion = await this.client.chat.completions.create(params);
    const choice = completion.choices[0];
    // Dengan reasoning_split: true, content bersih dari <think> tags
    const content = choice.message.content || '';
    return {
      content: this._stripThinkTags(content),
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
      // reasoning_split: true supaya <think> tags ga nyampur di content stream
      extra_body: { reasoning_split: true },
    };
    if (tools?.length) {
      params.tools = tools;
      params.tool_choice = 'auto';
    }

    const stream = await this.client.chat.completions.create(params);
    const toolCallBuffer = {};
    let fullContent = '';
    let hasContent = false;

    // State machine untuk handle <think> tags yang mungkin masih muncul
    // walau reasoning_split=true (fallback safety)
    let thinkBuffer = '';
    let insideThink = false;

    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta;

      if (delta?.content) {
        let raw = delta.content;

        // Safety: kalau ada <think> tag yang lolos, filter
        if (insideThink) {
          thinkBuffer += raw;
          const closeIdx = thinkBuffer.indexOf('</think>');
          if (closeIdx !== -1) {
            insideThink = false;
            raw = thinkBuffer.slice(closeIdx + 8); // ambil setelah </think>
            thinkBuffer = '';
          } else {
            continue; // masih di dalam thinking, skip
          }
        } else if (raw.includes('<think>')) {
          const openIdx = raw.indexOf('<think>');
          const beforeThink = raw.slice(0, openIdx);
          const afterOpen = raw.slice(openIdx + 7);

          if (beforeThink) {
            fullContent += beforeThink;
            hasContent = true;
            yield { type: 'text', content: beforeThink };
          }

          const closeIdx = afterOpen.indexOf('</think>');
          if (closeIdx !== -1) {
            // Whole think block dalam satu chunk
            raw = afterOpen.slice(closeIdx + 8);
          } else {
            // Multi-chunk think block
            insideThink = true;
            thinkBuffer = afterOpen;
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
        yield { type: 'text', content: '[Empty response from MiniMax]' };
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
        owned_by: 'minimax',
        contextWindow: null,
      }));
    } catch {
      return this.getRecommendedModels().map(id => ({
        id, owned_by: 'minimax', contextWindow: null,
      }));
    }
  }

  getRecommendedModels() {
    return [
      'MiniMax-M1',            // flagship, 1M ctx
      'MiniMax-M2-5',          // balance speed/quality
      'MiniMax-M2-5-highspeed',// faster variant
      'MiniMax-Text-01',       // legacy
    ];
  }

  getSystemPromptAppendix() {
    return `\n## MINIMAX PROVIDER\nPowered by MiniMax — 1M context window, strong at long-document tasks. Model: ${this.defaultModel}.`;
  }

  // Fallback strip jika reasoning_split tidak aktif
  _stripThinkTags(text) {
    return text.replace(THINK_TAG_RE, '').trim();
  }
}
