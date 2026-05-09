/**
 * Base Provider — semua provider harus extend class ini.
 * Enforces contract: chat(), stream(), listModels(), validateKey()
 */
export class BaseProvider {
  constructor(config) {
    this.name = 'base';
    this.config = config;
    this.baseUrl = '';
    this.supportsThinking = false;
    this.supportsToolCalling = false;
    this.defaultModel = '';
  }

  /** Validate that API key is set and auth works */
  async validate() {
    throw new Error('validate() not implemented');
  }

  /** Non-streaming chat completion */
  async chat({ messages, tools, model, temperature, maxTokens }) {
    throw new Error('chat() not implemented');
  }

  /** Streaming chat completion — returns AsyncGenerator */
  async *stream({ messages, tools, model, temperature, maxTokens, thinking }) {
    throw new Error('stream() not implemented');
  }

  /** Fetch available models from API */
  async listModels() {
    throw new Error('listModels() not implemented');
  }

  /** Get recommended models for this provider */
  getRecommendedModels() {
    return [];
  }

  /** Provider-specific system prompt appendix */
  getSystemPromptAppendix() {
    return '';
  }
}
