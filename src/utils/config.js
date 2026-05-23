import dotenv from 'dotenv';
import { resolve } from 'path';
import { autoDetectProvider, getApiKeyForProvider } from '../core/provider-factory.js';

dotenv.config({ path: resolve(process.cwd(), '.env') });

let _config = null;

export function loadConfig() {
  const provider = process.env.RXS_PROVIDER || 'auto';
  const resolvedProvider = provider === 'auto' ? autoDetectProvider() : provider;

  if (!resolvedProvider) {
    console.error('No API key found. Set one of these in .env:');
    console.error('');
    console.error('  === FAST / FREE ===');
    console.error('  GROQ_API_KEY        → https://console.groq.com        (fastest free, LPU)');
    console.error('  CEREBRAS_API_KEY    → https://cloud.cerebras.ai       (1M tok/day, WSE)');
    console.error('  SAMBANOVA_API_KEY   → https://cloud.sambanova.ai      (free, fast RDU)');
    console.error('');
    console.error('  === FREE CREDITS ===');
    console.error('  XAI_API_KEY         → https://console.x.ai            ($175 first month)');
    console.error('  TOGETHER_API_KEY    → https://api.together.ai         (~$100 credits)');
    console.error('  KIMI_API_KEY        → https://platform.moonshot.ai    (trial credits)');
    console.error('  QWEN_API_KEY        → https://alibabacloud.com        (trial credits)');
    console.error('  MINIMAX_API_KEY     → https://platform.minimax.io     (trial credits)');
    console.error('');
    console.error('  === ONGOING FREE TIER ===');
    console.error('  GEMINI_API_KEY      → https://aistudio.google.com     (1500 req/day)');
    console.error('  MISTRAL_API_KEY     → https://console.mistral.ai      (1B tok/month)');
    console.error('  OPENROUTER_API_KEY  → https://openrouter.ai/keys      (30+ free models)');
    console.error('  NVIDIA_NIM_API_KEY  → https://build.nvidia.com        (free NIM credits)');
    process.exit(1);
  }

  const apiKey = getApiKeyForProvider(resolvedProvider);
  if (!apiKey) {
    console.error(`API key for "${resolvedProvider}" not set.`);
    process.exit(1);
  }

  _config = {
    provider: resolvedProvider,
    apiKey,
    model: process.env.RXS_DEFAULT_MODEL || 'auto',
    maxContextTokens: parseInt(process.env.RXS_MAX_CONTEXT_TOKENS || '120000'),
    maxResponseTokens: parseInt(process.env.RXS_MAX_RESPONSE_TOKENS || '8000'),
    temperature: parseFloat(process.env.RXS_TEMPERATURE || '0.7'),
    permissionMode: process.env.RXS_PERMISSION_MODE || 'default',
  };

  return _config;
}

export function getConfig() {
  if (!_config) return loadConfig();
  return _config;
}

export function resetConfig() {
  _config = null;
  return loadConfig();
}
