import fs from 'fs/promises';
import { resolve, dirname, relative, isAbsolute } from 'path';
import {
  checkFileState, cacheFileRead, invalidateFile, FILE_UNCHANGED_STUB
} from '../core/file-state-cache.js';

export const fileTools = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: [
        'Read the contents of a file.',
        'For large files, use start_line and end_line to read only the relevant section.',
        'ALWAYS use line ranges when you only need part of a file — saves context.',
        'Tip: first read without ranges to get an overview (first ~40 lines are shown),',
        'then use ranges to dive into specific sections.',
      ].join('\n'),
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path to file' },
          start_line: {
            type: 'number',
            description: 'First line to read (1-indexed, inclusive). Omit to start from line 1.',
          },
          end_line: {
            type: 'number',
            description: 'Last line to read (1-indexed, inclusive). Omit to read to end of file.',
          },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: [
        'Write or OVERWRITE a file with completely new content.',
        'WARNING: This replaces the ENTIRE file. For modifying existing files,',
        'use edit_file (str_replace) instead — it is safer and more efficient.',
        'Use write_file only when creating content from scratch.',
      ].join('\n'),
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          content: { type: 'string', description: 'Complete file content' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_directory',
      description: 'List files and directories. Use glob for pattern-based search.',
      parameters: {
        type: 'object',
        properties: {
          path:      { type: 'string', default: '.' },
          recursive: { type: 'boolean', default: false },
        },
      },
    },
  },
];

function assertSafePath(cwd, inputPath) {
  const resolved = resolve(cwd, inputPath);
  const rel = relative(cwd, resolved);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`Path traversal denied: ${inputPath}`);
  }
  return resolved;
}

const MAX_READ_LINES = 500;   // cap for full reads without range
const MAX_READ_BYTES = 80000; // ~80KB

export async function handleFileTool(action, args, context) {
  const cwd = context.cwd || process.cwd();
  const safePath = assertSafePath(cwd, args.path || '.');

  // ── read_file ──────────────────────────────────────────────────────────────
  if (action === 'read_file') {
    // Check file state cache first
    const cacheStatus = await checkFileState(safePath, args.start_line, args.end_line);
    if (cacheStatus === 'unchanged') {
      return FILE_UNCHANGED_STUB;
    }

    let content;
    try {
      content = await fs.readFile(safePath, 'utf8');
    } catch (e) {
      if (e.code === 'ENOENT') throw new Error(`File not found: ${args.path}`);
      throw e;
    }

    const lines = content.split('\n');
    const totalLines = lines.length;

    const startLine = args.start_line ? Math.max(1, args.start_line) : null;
    const endLine   = args.end_line   ? Math.min(totalLines, args.end_line) : null;

    if (startLine || endLine) {
      // Ranged read
      const from = (startLine || 1) - 1;
      const to   = endLine ? endLine : totalLines;
      const slice = lines.slice(from, to);
      const rangedContent = slice.join('\n');

      await cacheFileRead(safePath, rangedContent, startLine, endLine);
      const header = `${args.path} (lines ${from + 1}–${to} of ${totalLines})`;
      return `${header}\n${'─'.repeat(header.length)}\n${rangedContent}`;
    }

    // Full read — guard against huge files
    if (content.length > MAX_READ_BYTES) {
      const preview = lines.slice(0, 60).join('\n');
      await cacheFileRead(safePath, preview, 1, 60);
      return (
        `${args.path} (${totalLines} lines — showing first 60; use start_line/end_line for more)\n` +
        `${'─'.repeat(50)}\n${preview}\n` +
        `\n[... ${totalLines - 60} more lines. Use start_line/end_line to read sections.]`
      );
    }

    await cacheFileRead(safePath, content, null, null);
    const header = `${args.path} (${totalLines} lines)`;
    return `${header}\n${'─'.repeat(header.length)}\n${content}`;
  }

  // ── write_file ─────────────────────────────────────────────────────────────
  if (action === 'write_file') {
    await fs.mkdir(dirname(safePath), { recursive: true });
    await fs.writeFile(safePath, args.content, 'utf8');
    invalidateFile(safePath);  // cache must be refreshed after write
    const lines = args.content.split('\n').length;
    return `Written: ${args.path} (${lines} lines, ${args.content.length} chars)`;
  }

  // ── list_directory ─────────────────────────────────────────────────────────
  if (action === 'list_directory') {
    const entries = await fs.readdir(safePath, { withFileTypes: true });

    if (!args.recursive) {
      return entries
        .map(e => `${e.isDirectory() ? 'DIR ' : 'FILE'} ${e.name}`)
        .join('\n') || '(empty directory)';
    }

    // Recursive — but skip node_modules etc.
    const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage']);
    const lines = [];

    async function walk(dir, prefix) {
      const ents = await fs.readdir(dir, { withFileTypes: true });
      for (const e of ents) {
        if (e.isDirectory() && SKIP.has(e.name)) continue;
        lines.push(`${prefix}${e.isDirectory() ? '📁' : '📄'} ${e.name}`);
        if (e.isDirectory() && lines.length < 300) {
          await walk(resolve(dir, e.name), prefix + '  ');
        }
      }
    }

    await walk(safePath, '');
    if (lines.length >= 300) lines.push('... (truncated at 300 entries)');
    return lines.join('\n') || '(empty directory)';
  }

  throw new Error(`Unknown file action: ${action}`);
}
