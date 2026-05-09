import { GroqProvider }       from '../providers/groq-provider.js';
import { NvidiaNimProvider }  from '../providers/nvidia-provider.js';
import { OpenRouterProvider } from '../providers/openrouter-provider.js';
import { GeminiProvider }     from '../providers/gemini-provider.js';
import { KimiProvider }       from '../providers/kimi-provider.js';
import { QwenProvider }       from '../providers/qwen-provider.js';
import { MiniMaxProvider }    from '../providers/minimax-provider.js';
import { CerebrasProvider }   from '../providers/cerebras-provider.js';
import { MistralProvider }    from '../providers/mistral-provider.js';
import { XAIProvider }        from '../providers/xai-provider.js';
import { SambaNovProvider }   from '../providers/sambanova-provider.js';
import { TogetherProvider }   from '../providers/together-provider.js';

const PROVIDER_REGISTRY = {
  groq:       GroqProvider,
  nvidia:     NvidiaNimProvider,
  openrouter: OpenRouterProvider,
  gemini:     GeminiProvider,
  kimi:       KimiProvider,
  qwen:       QwenProvider,
  minimax:    MiniMaxProvider,
  cerebras:   CerebrasProvider,
  mistral:    MistralProvider,
  xai:        XAIProvider,
  sambanova:  SambaNovProvider,
  together:   TogetherProvider,
};

export function getAvailableProviders() {
  return Object.keys(PROVIDER_REGISTRY);
}

export function getProviderClass(name) {
  const cls = PROVIDER_REGISTRY[name];
  if (!cls) throw new Error(`Unknown provider: "${name}". Available: ${getAvailableProviders().join(', ')}`);
  return cls;
}

/**
 * Auto-detect dari env vars.
 * Priority: GROQ → OPENROUTER → GEMINI → CEREBRAS → MISTRAL → XAI
 *           → KIMI → QWEN → SAMBANOVA → TOGETHER → MINIMAX → NVIDIA
 */
export function autoDetectProvider() {
  if (process.env.GROQ_API_KEY)        return 'groq';
  if (process.env.OPENROUTER_API_KEY)  return 'openrouter';
  if (process.env.GEMINI_API_KEY)      return 'gemini';
  if (process.env.CEREBRAS_API_KEY)    return 'cerebras';
  if (process.env.MISTRAL_API_KEY)     return 'mistral';
  if (process.env.XAI_API_KEY)         return 'xai';
  if (process.env.KIMI_API_KEY)        return 'kimi';
  if (process.env.QWEN_API_KEY)        return 'qwen';
  if (process.env.SAMBANOVA_API_KEY)   return 'sambanova';
  if (process.env.TOGETHER_API_KEY)    return 'together';
  if (process.env.MINIMAX_API_KEY)     return 'minimax';
  if (process.env.NVIDIA_NIM_API_KEY)  return 'nvidia';
  return null;
}

export async function createProvider(providerName, config) {
  const ProviderClass = getProviderClass(providerName);
  return new ProviderClass({ apiKey: config.apiKey });
}

export function getApiKeyForProvider(name) {
  const keyMap = {
    groq:       process.env.GROQ_API_KEY,
    nvidia:     process.env.NVIDIA_NIM_API_KEY,
    openrouter: process.env.OPENROUTER_API_KEY,
    gemini:     process.env.GEMINI_API_KEY,
    kimi:       process.env.KIMI_API_KEY,
    qwen:       process.env.QWEN_API_KEY,
    minimax:    process.env.MINIMAX_API_KEY,
    cerebras:   process.env.CEREBRAS_API_KEY,
    mistral:    process.env.MISTRAL_API_KEY,
    xai:        process.env.XAI_API_KEY,
    sambanova:  process.env.SAMBANOVA_API_KEY,
    together:   process.env.TOGETHER_API_KEY,
  };
  return keyMap[name] || null;
}
