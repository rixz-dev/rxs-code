import fs from 'fs/promises';
import { join, relative, resolve, isAbsolute } from 'path';

// ─── Tool Definition ──────────────────────────────────────────────────────────

export const globTools = [
  {
    type: 'function',
    function: {
      name: 'glob',
      description: [
        'Find files matching a glob pattern. Use this BEFORE reading or editing files',
        'when you need to discover which files exist. Much faster than list_directory.',
        'Examples:',
        '  • "**/*.ts"         — all TypeScript files recursively',
        '  • "src/**/*.js"     — JS files inside src/',
        '  • "*.json"          — JSON files in the root only',
        '  • "**/*test*"       — any file with "test" in the name',
      ].join('\n'),
      parameters: {
        type: 'object',
        properties: {
          pattern: {
            type: 'string',
            description: 'Glob pattern to match (supports **, *, ?, [abc])',
          },
          path: {
            type: 'string',
            description: 'Root directory to search from (default: project root)',
          },
          limit: {
            type: 'number',
            description: 'Max results to return (default: 100)',
          },
        },
        required: ['pattern'],
      },
    },
  },
];

// ─── Glob Engine ──────────────────────────────────────────────────────────────

/**
 * Convert a glob pattern to a RegExp.
 * Supports: ** (any depth), * (any in segment), ? (single char), [abc] (char class)
 */
function globToRegex(pattern) {
  let regStr = '';
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === '*' && pattern[i + 1] === '*') {
      // ** matches zero or more path segments
      regStr += '(?:.+/)?';
      i += 2;
      if (pattern[i] === '/') i++; // skip trailing slash after **
    } else if (ch === '*') {
      regStr += '[^/]*';
      i++;
    } else if (ch === '?') {
      regStr += '[^/]';
      i++;
    } else if (ch === '[') {
      // pass char class through
      const end = pattern.indexOf(']', i);
      if (end === -1) {
        regStr += '\\[';
        i++;
      } else {
        regStr += pattern.slice(i, end + 1);
        i = end + 1;
      }
    } else {
      // Escape regex special chars
      regStr += ch.replace(/[.+^${}()|\\]/g, '\\$&');
      i++;
    }
  }
  return new RegExp(`^${regStr}$`);
}

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.svn', '.hg', 'dist', 'build',
  '.next', '.nuxt', 'out', 'coverage', '.cache', '__pycache__',
  '.venv', 'venv', '.tox',
]);

async function walkGlob(dir, regex, results, limit) {
  if (results.length >= limit) return;
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (results.length >= limit) break;
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      await walkGlob(join(dir, entry.name), regex, results, limit);
    } else if (entry.isFile()) {
      const fullPath = join(dir, entry.name);
      const relPath  = relative(results._root, fullPath);
      if (regex.test(relPath)) {
        results.push(relPath);
      }
    }
  }
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function handleGlobTool(args, context) {
  const cwd  = context.cwd || process.cwd();
  const root = args.path ? resolve(cwd, args.path) : cwd;
  const limit = Math.min(args.limit || 100, 500);

  // Safety check
  const rel = relative(cwd, root);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`Path traversal denied: ${args.path}`);
  }

  const pattern = args.pattern;
  if (!pattern || typeof pattern !== 'string') {
    throw new Error('glob requires a pattern string');
  }

  const regex   = globToRegex(pattern);
  const results = [];
  results._root = root;

  const start = Date.now();
  await walkGlob(root, regex, results, limit);
  const ms = Date.now() - start;

  if (results.length === 0) {
    return `No files matched pattern "${pattern}" in ${args.path || '.'}`;
  }

  const truncated = results.length >= limit;
  const header = `${results.length}${truncated ? '+' : ''} files matched "${pattern}" (${ms}ms)${truncated ? ' [limit reached]' : ''}`;
  return `${header}\n${results.join('\n')}`;
}
