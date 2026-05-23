import OpenAI from 'openai';
import { BaseProvider } from './base.js';

export class MistralProvider extends BaseProvider {
  constructor(config) {
    super(config);
    this.name = 'mistral';
    this.baseUrl = 'https://api.mistral.ai/v1';
    this.supportsThinking = false; // Mistral Large/Codestral belum expose thinking API
    this.supportsToolCalling = true;
    this.defaultModel = 'codestral-latest';

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
    if (!this.config.apiKey) throw new Error('MISTRAL_API_KEY not set');
    try {
      await this.client.models.list();
      return true;
    } catch (e) {
      if (e.status === 401) throw new Error('Invalid Mistral API key');
      if (e.status === 429) return true;
      throw new Error(`Mistral error: ${e.message}`);
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
        yield { type: 'text', content: '[Empty response from Mistral]' };
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
        owned_by: 'mistralai',
        contextWindow: null,
      }));
    } catch {
      return this.getRecommendedModels().map(id => ({
        id, owned_by: 'mistralai', contextWindow: null,
      }));
    }
  }

  getRecommendedModels() {
    return [
      'codestral-latest',     // best for coding — free tier
      'mistral-large-latest', // flagship text model
      'mistral-small-latest', // cheaper, still capable
      'pixtral-large-latest', // multimodal (vision)
      'mistral-embed',        // embeddings
      'open-mistral-nemo',    // open 12B, fast
      'open-codestral-mamba', // OSS coding model
    ];
  }

  getSystemPromptAppendix() {
    return `\n## MISTRAL PROVIDER\nPowered by Mistral AI — EU-based, strong at coding via Codestral. Free tier: 1B tokens/month, all models. Model: ${this.defaultModel}.`;
  }
}
