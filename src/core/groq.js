import Groq from "groq-sdk";
import { getConfig } from "../utils/config.js";
import { log } from "../utils/logger.js";

export class GroqClient {
  constructor() {
    const config = getConfig();
    this.client = new Groq({ apiKey: config.apiKey });
    this.model = config.model;
    this.maxTokens = config.maxTokens;
  }

  async chat({ messages, tools = null, temperature = 0.7 }) {
    try {
      const params = {
        model: this.model,
        messages,
        temperature,
        max_tokens: this.maxTokens,
      };
      if (tools) {
        params.tools = tools;
        params.tool_choice = "auto";
      }

      const completion = await this.client.chat.completions.create(params);
      const choice = completion.choices[0];

      return {
        content: choice.message.content || "",
        toolCalls: choice.message.tool_calls || [],
        finishReason: choice.finish_reason,
      };
    } catch (error) {
      log.error(`Groq API error: ${error.message}`);
      if (error.status === 429) throw new Error("Rate limit. Coba lagi nanti.");
      throw error;
    }
  }

  // PHASE 2: Streaming untuk output real-time
  async *streamResponse({ messages, tools }) {
    const params = {
      model: this.model,
      messages,
      max_tokens: this.maxTokens,
      temperature: 0.7,
    };
    if (tools) {
      params.tools = tools;
      params.tool_choice = "auto";
    }

    const stream = await this.client.chat.completions.create({
      ...params,
      stream: true,
    });

    let toolCallBuffer = {};
    let fullContent = "";
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      if (delta?.content) {
        fullContent += delta.content;
        yield { type: "text", content: delta.content };
      }
      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          const index = tc.index;
          if (!toolCallBuffer[index]) {
            toolCallBuffer[index] = {
              id: tc.id || "",
              type: "function",
              function: { name: "", arguments: "" },
            };
          }
          if (tc.function?.name) toolCallBuffer[index].function.name += tc.function.name;
          if (tc.function?.arguments) toolCallBuffer[index].function.arguments += tc.function.arguments;
        }
      }
    }

    const toolCalls = Object.values(toolCallBuffer).filter(tc => tc.function.name);
    if (toolCalls.length > 0) {
      yield { type: "tool_calls", content: toolCalls, fullContent };
    }
  }
}
