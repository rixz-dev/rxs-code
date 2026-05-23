/**
 * Tavily Web Tools — web_search + web_fetch
 * 
 * web_search : cari info terbaru di internet via Tavily Search API
 * web_fetch  : ambil konten bersih dari URL spesifik via Tavily Extract API
 * 
 * Kedua tools hanya aktif jika TAVILY_API_KEY tersedia di env.
 * Kalau key tidak ada, tool tetap terdaftar tapi return error yang jelas.
 */

const TAVILY_BASE = 'https://api.tavily.com';

function getTavilyKey() {
  return process.env.TAVILY_API_KEY || null;
}

// ─── Tool Definitions (OpenAI function calling format) ───────────────────────

export const webFetchTools = [
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: [
        'Search the web for up-to-date information using Tavily.',
        'Use when you need current news, documentation, recent releases,',
        'or any information that may have changed after your training cutoff.',
        'Returns ranked results with titles, URLs, and extracted content.',
      ].join(' '),
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The search query. Be specific and concise for best results.',
          },
          search_depth: {
            type: 'string',
            enum: ['basic', 'advanced'],
            description: 'basic = fast (default), advanced = deeper crawl, more accurate.',
          },
          max_results: {
            type: 'integer',
            description: 'Number of results to return (1-10, default 5).',
            minimum: 1,
            maximum: 10,
          },
          include_answer: {
            type: 'boolean',
            description: 'Include an AI-generated answer synthesized from results.',
          },
          include_domains: {
            type: 'array',
            items: { type: 'string' },
            description: 'Restrict results to these domains only (e.g. ["github.com", "docs.npmjs.com"]).',
          },
          exclude_domains: {
            type: 'array',
            items: { type: 'string' },
            description: 'Exclude these domains from results.',
          },
        },
        required: ['query'],
      },
    },
  },

  {
    type: 'function',
    function: {
      name: 'web_fetch',
      description: [
        'Fetch and extract clean text content from one or more URLs using Tavily.',
        'Use when you have specific URLs to read — documentation pages, GitHub files,',
        'blog posts, API references, or any web page.',
        'Returns clean markdown-ready text stripped of ads, nav, and boilerplate.',
        'Can process up to 20 URLs in one call.',
      ].join(' '),
      parameters: {
        type: 'object',
        properties: {
          urls: {
            type: 'array',
            items: { type: 'string' },
            description: 'List of URLs to extract content from (max 20).',
            maxItems: 20,
          },
          extract_depth: {
            type: 'string',
            enum: ['basic', 'advanced'],
            description: 'basic = main content only (default), advanced = full page including tables/code.',
          },
        },
        required: ['urls'],
      },
    },
  },
];

// ─── Handlers ─────────────────────────────────────────────────────────────────

export async function handleWebFetchTool(name, args) {
  const apiKey = getTavilyKey();

  if (!apiKey) {
    return [
      'Error: TAVILY_API_KEY not set.',
      'Add it to your .env: TAVILY_API_KEY=tvly-...',
      'Get a free key (1000 searches/month, no CC) at https://app.tavily.com',
    ].join('\n');
  }

  try {
    if (name === 'web_search') return await _search(apiKey, args);
    if (name === 'web_fetch')  return await _extract(apiKey, args);
    return `Unknown web tool: ${name}`;
  } catch (err) {
    // Surface useful error bukan stack trace
    if (err.status === 401) return 'Error: Invalid Tavily API key. Check TAVILY_API_KEY.';
    if (err.status === 429) return 'Error: Tavily rate limit hit. Free tier = 1000/month. Wait or upgrade.';
    if (err.status === 400) return `Error: Bad request to Tavily — ${err.message}`;
    return `Web tool error: ${err.message}`;
  }
}

// ─── Internal ─────────────────────────────────────────────────────────────────

async function _search(apiKey, args) {
  const {
    query,
    search_depth = 'basic',
    max_results = 5,
    include_answer = false,
    include_domains,
    exclude_domains,
  } = args;

  if (!query || typeof query !== 'string' || query.trim().length === 0) {
    return 'Error: query must be a non-empty string';
  }
  if (query.length > 400) {
    return 'Error: query too long (max 400 chars)';
  }

  const body = {
    api_key: apiKey,
    query: query.trim(),
    search_depth,
    max_results: Math.min(Math.max(1, max_results), 10),
    include_answer,
    include_raw_content: false,  // pakai content field — lebih bersih
  };

  if (Array.isArray(include_domains) && include_domains.length > 0) {
    body.include_domains = include_domains;
  }
  if (Array.isArray(exclude_domains) && exclude_domains.length > 0) {
    body.exclude_domains = exclude_domains;
  }

  const data = await _post('/search', body);

  if (!data.results?.length) {
    return `No results found for: "${query}"`;
  }

  const lines = [];

  if (include_answer && data.answer) {
    lines.push(`## Answer\n${data.answer}\n`);
  }

  lines.push(`## Search Results (${data.results.length}) — "${query}"\n`);

  for (const [i, r] of data.results.entries()) {
    lines.push(`### ${i + 1}. ${r.title || 'Untitled'}`);
    lines.push(`URL: ${r.url}`);
    if (r.published_date) lines.push(`Date: ${r.published_date}`);
    lines.push(`Score: ${r.score?.toFixed(3) ?? 'n/a'}`);
    if (r.content) {
      // Trim content supaya context window gak meledak
      const snippet = r.content.length > 800
        ? r.content.slice(0, 800) + '...'
        : r.content;
      lines.push(`\n${snippet}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

async function _extract(apiKey, args) {
  const { urls, extract_depth = 'basic' } = args;

  if (!Array.isArray(urls) || urls.length === 0) {
    return 'Error: urls must be a non-empty array';
  }
  if (urls.length > 20) {
    return 'Error: max 20 URLs per call';
  }

  // Validasi URL format sederhana
  const validUrls = urls.filter(u => {
    try { new URL(u); return true; } catch { return false; }
  });

  if (validUrls.length === 0) {
    return 'Error: no valid URLs provided';
  }

  const body = {
    api_key: apiKey,
    urls: validUrls,
    extract_depth,
  };

  const data = await _post('/extract', body);
  const lines = [];

  if (data.results?.length) {
    for (const r of data.results) {
      lines.push(`## ${r.url}\n`);
      if (r.raw_content) {
        // Cap per URL supaya context window aman — ~4K chars
        const content = r.raw_content.length > 4000
          ? r.raw_content.slice(0, 4000) + '\n\n[... content truncated ...]'
          : r.raw_content;
        lines.push(content);
      } else {
        lines.push('(no content extracted)');
      }
      lines.push('\n---\n');
    }
  }

  if (data.failed_results?.length) {
    lines.push('## Failed URLs');
    for (const f of data.failed_results) {
      lines.push(`- ${f.url}: ${f.error || 'failed'}`);
    }
  }

  if (lines.length === 0) {
    return 'No content could be extracted from the provided URLs.';
  }

  return lines.join('\n');
}

async function _post(path, body) {
  const res = await fetch(`${TAVILY_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000), // 30s timeout
  });

  if (!res.ok) {
    const err = new Error(`Tavily ${path} failed: HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }

  return res.json();
}
