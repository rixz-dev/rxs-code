/**
 * cost.js — Token cost tracking for rxs-code
 * Tracks per-session API token usage + estimated cost
 */

// Price per 1M tokens (USD) — approximate, as of mid-2025
// Format: { input: N, output: N, cached?: N }
const PRICE_TABLE = {
  // Groq
  'llama-3.3-70b-versatile':       { input: 0.59,  output: 0.79  },
  'llama-3.1-8b-instant':          { input: 0.05,  output: 0.08  },
  'llama3-70b-8192':               { input: 0.59,  output: 0.79  },
  'mixtral-8x7b-32768':            { input: 0.24,  output: 0.24  },
  'gemma2-9b-it':                  { input: 0.20,  output: 0.20  },
  'moonshotai/kimi-k2-instruct':   { input: 0.60,  output: 2.50  },
  // NVIDIA NIM
  'nvidia/llama-3.1-nemotron-70b-instruct': { input: 0.35, output: 0.40 },
  'meta/llama-3.3-70b-instruct':   { input: 0.23,  output: 0.40  },
  'qwen/qwen3-235b-a22b':          { input: 0.20,  output: 0.60  },
  // OpenRouter
  'deepseek/deepseek-r1':          { input: 0.55,  output: 2.19  },
  'mistralai/mistral-small-3.2-24b-instruct': { input: 0.10, output: 0.30 },
  // Cerebras
  'llama3.1-70b':                  { input: 0.60,  output: 0.60  },
  'llama3.1-8b':                   { input: 0.10,  output: 0.10  },
  // SambaNova
  'Meta-Llama-3.3-70B-Instruct':   { input: 0.60,  output: 1.20  },
  // xAI
  'grok-3-mini-fast':              { input: 0.30,  output: 0.50  },
  // Gemini
  'gemini-2.0-flash':              { input: 0.10,  output: 0.40  },
  'gemini-2.5-flash-preview-05-20':{ input: 0.15,  output: 0.60  },
  // Default fallback
  '__default__':                   { input: 0.30,  output: 0.60  },
};

function getPrice(modelId) {
  // Exact match first
  if (PRICE_TABLE[modelId]) return PRICE_TABLE[modelId];
  // Partial match (e.g. "llama-3.3-70b" anywhere in the ID)
  const key = Object.keys(PRICE_TABLE).find(k => modelId?.includes(k) || k.includes(modelId?.split('/').pop() || ''));
  return key ? PRICE_TABLE[key] : PRICE_TABLE['__default__'];
}

export class CostTracker {
  constructor() {
    this.reset();
  }

  reset() {
    this.inputTokens  = 0;
    this.outputTokens = 0;
    this.turns        = 0;
    this.startedAt    = Date.now();
    this.lastModel    = null;
  }

  /**
   * Record a turn's token usage
   * @param {number} inputTok
   * @param {number} outputTok
   * @param {string} modelId
   */
  record(inputTok, outputTok, modelId) {
    this.inputTokens  += inputTok  || 0;
    this.outputTokens += outputTok || 0;
    this.turns        += 1;
    this.lastModel     = modelId || this.lastModel;
  }

  /** Estimate cost in USD */
  estimateCost(modelId) {
    const price  = getPrice(modelId || this.lastModel || '__default__');
    const inCost = (this.inputTokens  / 1_000_000) * price.input;
    const outCost= (this.outputTokens / 1_000_000) * price.output;
    return { inCost, outCost, total: inCost + outCost, price };
  }

  /** Get session duration string */
  duration() {
    const secs  = Math.round((Date.now() - this.startedAt) / 1000);
    const mins  = Math.floor(secs / 60);
    const s     = secs % 60;
    return mins > 0 ? `${mins}m ${s}s` : `${s}s`;
  }

  /** Full stats summary object */
  summary(modelId) {
    const cost = this.estimateCost(modelId);
    return {
      turns:        this.turns,
      inputTokens:  this.inputTokens,
      outputTokens: this.outputTokens,
      totalTokens:  this.inputTokens + this.outputTokens,
      costUSD:      cost.total,
      inCostUSD:    cost.inCost,
      outCostUSD:   cost.outCost,
      priceTable:   cost.price,
      duration:     this.duration(),
      model:        modelId || this.lastModel || 'unknown',
    };
  }
}
