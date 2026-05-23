import fs from 'fs/promises';
import { resolve, relative, isAbsolute, dirname } from 'path';
import { invalidateFile } from '../core/file-state-cache.js';

// ─── Tool Definition ──────────────────────────────────────────────────────────

export const fileEditTools = [
  {
    type: 'function',
    function: {
      name: 'edit_file',
      description: [
        'Surgically edit a file by replacing an exact string with a new one.',
        'PREFER this over write_file for any change to an existing file — it is',
        'faster, uses less context, and shows the diff clearly.',
        'Rules:',
        '  • old_str MUST appear exactly once in the file.',
        '  • Include enough surrounding lines to make it unique.',
        '  • new_str replaces old_str verbatim (preserve indentation).',
        '  • To INSERT text, set old_str to the line directly before the insert point.',
        '  • To DELETE lines, set new_str to an empty string "".',
      ].join('\n'),
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Relative path to the file to edit',
          },
          old_str: {
            type: 'string',
            description: 'The exact string to find and replace (must be unique in the file)',
          },
          new_str: {
            type: 'string',
            description: 'The replacement string. Use "" to delete old_str.',
          },
        },
        required: ['path', 'old_str', 'new_str'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_file',
      description: 'Create a new file with the given content. Fails if the file already exists — use edit_file to modify existing files.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path for the new file' },
          content: { type: 'string', description: 'Full file content' },
        },
        required: ['path', 'content'],
      },
    },
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function assertSafePath(cwd, inputPath) {
  const resolved = resolve(cwd, inputPath);
  const rel = relative(cwd, resolved);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`Path traversal denied: ${inputPath}`);
  }
  return resolved;
}

function buildDiff(oldContent, newContent, path) {
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');
  let added = 0, removed = 0;
  // Count rough diff
  const maxLen = Math.max(oldLines.length, newLines.length);
  for (let i = 0; i < maxLen; i++) {
    if (oldLines[i] !== newLines[i]) {
      if (i < oldLines.length) removed++;
      if (i < newLines.length) added++;
    }
  }
  return `✎ ${path}  (+${added} -${removed} lines)`;
}

// ─── Handlers ────────────────────────────────────────────────────────────────

export async function handleFileEditTool(action, args, context) {
  const cwd = context.cwd || process.cwd();
  const safePath = assertSafePath(cwd, args.path);

  if (action === 'edit_file') {
    const { old_str, new_str } = args;

    if (old_str === undefined || new_str === undefined) {
      throw new Error('edit_file requires both old_str and new_str');
    }

    let content;
    try {
      content = await fs.readFile(safePath, 'utf8');
    } catch (e) {
      if (e.code === 'ENOENT') {
        throw new Error(`File not found: ${args.path}. Use create_file to make a new file.`);
      }
      throw e;
    }

    // Count occurrences
    const occurrences = content.split(old_str).length - 1;

    if (occurrences === 0) {
      // Try to give a helpful hint
      const lines = content.split('\n');
      const searchLines = old_str.split('\n');
      const firstSearchLine = searchLines[0].trim();
      const closeLine = lines.find(l => l.includes(firstSearchLine));
      const hint = closeLine
        ? `\nClosest match found: ${closeLine.trim()}`
        : '\nNo similar lines found — check indentation and whitespace.';
      throw new Error(`old_str not found in ${args.path}.${hint}`);
    }

    if (occurrences > 1) {
      throw new Error(
        `old_str appears ${occurrences} times in ${args.path}. ` +
        `Add more surrounding context to make it unique.`
      );
    }

    const newContent = content.replace(old_str, new_str);
    await fs.writeFile(safePath, newContent, 'utf8');
    invalidateFile(safePath);  // force re-read next time

    const diffSummary = buildDiff(content, newContent, args.path);
    const lineCount = newContent.split('\n').length;
    return `${diffSummary}\n${lineCount} lines total`;
  }

  if (action === 'create_file') {
    // Check it doesn't exist
    try {
      await fs.access(safePath);
      throw new Error(
        `File already exists: ${args.path}. Use edit_file to modify it.`
      );
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
    await fs.mkdir(dirname(safePath), { recursive: true });
    await fs.writeFile(safePath, args.content, 'utf8');
    invalidateFile(safePath);
    const lines = args.content.split('\n').length;
    return `Created: ${args.path} (${lines} lines, ${args.content.length} chars)`;
  }

  throw new Error(`Unknown edit action: ${action}`);
}
