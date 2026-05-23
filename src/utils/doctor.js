/**
 * doctor.js — Environment diagnostics for rxs-code
 * Checks Node version, API keys, tools availability, git, network
 */

import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import os from 'os';

function cmd(command) {
  try {
    const r = spawnSync('sh', ['-c', command], { encoding: 'utf8', timeout: 5000 });
    return { ok: r.status === 0, out: r.stdout?.trim() || '', err: r.stderr?.trim() || '' };
  } catch {
    return { ok: false, out: '', err: 'not found' };
  }
}

function check(label, ok, detail = '', fix = '') {
  return { label, ok, detail, fix };
}

// ─── Provider Health Ping ─────────────────────────────────────────────────────

const PROVIDER_PING = {
  groq: {
    url: 'https://api.groq.com/openai/v1/chat/completions',
    headers: k => ({ 'Authorization': `Bearer ${k}`, 'Content-Type': 'application/json' }),
    body: JSON.stringify({ model: 'llama-3.1-8b-instant', messages: [{ role: 'user', content: 'hi' }], max_tokens: 1 }),
  },
  gemini: {
    url: k => `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${k}`,
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ contents: [{ parts: [{ text: 'hi' }] }], generationConfig: { maxOutputTokens: 1 } }),
  },
  openrouter: {
    url: 'https://openrouter.ai/api/v1/chat/completions',
    headers: k => ({ 'Authorization': `Bearer ${k}`, 'Content-Type': 'application/json' }),
    body: JSON.stringify({ model: 'meta-llama/llama-3.1-8b-instruct:free', messages: [{ role: 'user', content: 'hi' }], max_tokens: 1 }),
  },
  mistral: {
    url: 'https://api.mistral.ai/v1/chat/completions',
    headers: k => ({ 'Authorization': `Bearer ${k}`, 'Content-Type': 'application/json' }),
    body: JSON.stringify({ model: 'mistral-small-latest', messages: [{ role: 'user', content: 'hi' }], max_tokens: 1 }),
  },
  cerebras: {
    url: 'https://api.cerebras.ai/v1/chat/completions',
    headers: k => ({ 'Authorization': `Bearer ${k}`, 'Content-Type': 'application/json' }),
    body: JSON.stringify({ model: 'llama3.1-8b', messages: [{ role: 'user', content: 'hi' }], max_tokens: 1 }),
  },
  xai: {
    url: 'https://api.x.ai/v1/chat/completions',
    headers: k => ({ 'Authorization': `Bearer ${k}`, 'Content-Type': 'application/json' }),
    body: JSON.stringify({ model: 'grok-3-mini', messages: [{ role: 'user', content: 'hi' }], max_tokens: 1 }),
  },
};

const KEY_MAP = {
  groq:       'GROQ_API_KEY',
  gemini:     'GEMINI_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  mistral:    'MISTRAL_API_KEY',
  cerebras:   'CEREBRAS_API_KEY',
  xai:        'XAI_API_KEY',
};

async function pingProvider(name) {
  const cfg = PROVIDER_PING[name];
  const keyEnv = KEY_MAP[name];
  const key = process.env[keyEnv];
  if (!key) return { ok: false, ms: null, reason: 'no key' };

  const url = typeof cfg.url === 'function' ? cfg.url(key) : cfg.url;
  const start = Date.now();

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: cfg.headers(key),
      body: cfg.body,
      signal: AbortSignal.timeout(8000),
    });
    const ms = Date.now() - start;

    if (res.status === 401) return { ok: false, ms, reason: 'invalid key' };
    if (res.status === 429) return { ok: false, ms, reason: 'rate limited' };
    if (res.status >= 500) return { ok: false, ms, reason: `server error ${res.status}` };

    return { ok: res.ok || res.status < 400, ms, reason: res.ok ? 'ok' : `${res.status}` };
  } catch (e) {
    const ms = Date.now() - start;
    if (e.name === 'TimeoutError') return { ok: false, ms: null, reason: 'timeout (8s)' };
    return { ok: false, ms, reason: e.message?.slice(0, 40) || 'network error' };
  }
}

export async function runProviderHealthCheck() {
  const configured = Object.keys(KEY_MAP).filter(n => process.env[KEY_MAP[n]]);
  if (configured.length === 0) return [];

  const results = await Promise.all(
    configured.map(async name => {
      const ping = await pingProvider(name);
      return { name, ...ping };
    })
  );
  return results;
}

export async function runDoctor() {
  const results = [];

  // ── Node.js ───────────────────────────────────────────────────────────────
  const nodeVer = process.version;
  const nodeMajor = parseInt(nodeVer.slice(1));
  results.push(check(
    'Node.js',
    nodeMajor >= 18,
    nodeVer,
    nodeMajor < 18 ? 'Upgrade to Node.js 18+. Use nvm or pkg install nodejs.' : '',
  ));

  // ── npm / Package Manager ─────────────────────────────────────────────────
  const npm = cmd('npm --version');
  results.push(check('npm', npm.ok, npm.ok ? `v${npm.out}` : 'not found',
    npm.ok ? '' : 'pkg install nodejs (includes npm)'));

  // ── Git ───────────────────────────────────────────────────────────────────
  const git = cmd('git --version');
  results.push(check('git', git.ok, git.ok ? git.out : 'not found',
    git.ok ? '' : 'pkg install git'));

  // ── ripgrep ───────────────────────────────────────────────────────────────
  const rg = cmd('rg --version');
  results.push(check('ripgrep (rg)', rg.ok,
    rg.ok ? rg.out.split('\n')[0] : 'not found — using grep fallback',
    rg.ok ? '' : 'pkg install ripgrep  (faster search)'));

  // ── curl ──────────────────────────────────────────────────────────────────
  const curl = cmd('curl --version');
  results.push(check('curl', curl.ok,
    curl.ok ? curl.out.split('\n')[0] : 'not found',
    curl.ok ? '' : 'pkg install curl'));

  // ── Termux extras ─────────────────────────────────────────────────────────
  const isTermux = existsSync('/data/data/com.termux') || !!process.env.TERMUX_VERSION;
  if (isTermux) {
    const clipSet = cmd('which termux-clipboard-set');
    results.push(check('termux-api (clipboard)', clipSet.ok,
      clipSet.ok ? 'available' : 'not found',
      clipSet.ok ? '' : 'pkg install termux-api  (enables /copy command)'));
  }

  // ── .env file ────────────────────────────────────────────────────────────
  const envExists = existsSync(join(process.cwd(), '.env'))
    || existsSync(join(os.homedir(), '.rxs-code', '.env'));
  results.push(check('.env file', envExists,
    envExists ? 'found' : 'not found in cwd or ~/.rxs-code/',
    envExists ? '' : 'Copy .env.example → .env and fill in API keys'));

  // ── API Keys ──────────────────────────────────────────────────────────────
  const keyChecks = [
    ['GROQ_API_KEY',       'Groq'],
    ['NVIDIA_API_KEY',     'NVIDIA NIM'],
    ['OPENROUTER_API_KEY', 'OpenRouter'],
    ['GEMINI_API_KEY',     'Gemini'],
    ['XAI_API_KEY',        'xAI (Grok)'],
    ['CEREBRAS_API_KEY',   'Cerebras'],
    ['SAMBANOVA_API_KEY',  'SambaNova'],
    ['TOGETHER_API_KEY',   'Together AI'],
    ['KIMI_API_KEY',       'Kimi (Moonshot)'],
    ['MISTRAL_API_KEY',    'Mistral'],
  ];
  const configuredKeys = keyChecks.filter(([k]) => !!process.env[k]);
  results.push(check(
    'API keys configured',
    configuredKeys.length > 0,
    configuredKeys.length > 0
      ? configuredKeys.map(([, name]) => name).join(', ')
      : 'No API keys found',
    configuredKeys.length === 0 ? 'Add at least one API key to .env' : '',
  ));

  // ── ~/.rxs-code dir ───────────────────────────────────────────────────────
  const rxsDir = existsSync(join(os.homedir(), '.rxs-code'));
  results.push(check('~/.rxs-code config dir', rxsDir,
    rxsDir ? join(os.homedir(), '.rxs-code') : 'not yet created',
    rxsDir ? '' : 'Will be created automatically on first use'));

  // ── RXSCODE.md context file ───────────────────────────────────────────────
  const ctxFile = existsSync(join(process.cwd(), 'RXSCODE.md'));
  results.push(check('RXSCODE.md (project context)', ctxFile,
    ctxFile ? 'found — will be auto-loaded' : 'not found (optional)',
    ''));

  // ── Network ───────────────────────────────────────────────────────────────
  const net = cmd('curl -s --max-time 3 https://api.groq.com/health 2>/dev/null || echo ok');
  results.push(check('Network connectivity', net.ok || net.out.includes('ok'),
    'internet reachable', ''));

  return results;
}
