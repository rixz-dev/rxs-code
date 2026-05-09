import fs from 'fs/promises';
import { resolve, dirname, relative, isAbsolute } from 'path';

export const fileTools = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read the full contents of a file',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path to file' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Write or overwrite a file with new content',
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
      description: 'List files in a directory',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', default: '.' },
          recursive: { type: 'boolean', default: false },
        },
      },
    },
  },
];

function assertSafePath(cwd, inputPath) {
  const resolved = resolve(cwd, inputPath);
  const rel = relative(cwd, resolved);
  // rel starts with '..' = escape attempt; isAbsolute = absolute path bypass
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`Path traversal denied: ${inputPath}`);
  }
  return resolved;
}

export async function handleFileTool(action, args, context) {
  const cwd = context.cwd || process.cwd();
  const safePath = assertSafePath(cwd, args.path || '.');

  if (action === 'read_file') {
    return await fs.readFile(safePath, 'utf8');
  }

  if (action === 'write_file') {
    await fs.mkdir(dirname(safePath), { recursive: true });
    await fs.writeFile(safePath, args.content, 'utf8');
    return `Written: ${args.path} (${args.content.length} chars)`;
  }

  if (action === 'list_directory') {
    const entries = await fs.readdir(safePath, { withFileTypes: true });
    return entries
      .map(e => `${e.isDirectory() ? 'DIR' : 'FILE'}  ${e.name}`)
      .join('\n');
  }

  throw new Error(`Unknown file action: ${action}`);
}
