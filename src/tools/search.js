import { spawnSync } from 'child_process';

export const searchTools = [
  {
    type: 'function',
    function: {
      name: 'search_codebase',
      description: 'Search for a regex pattern in files (grep)',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string' },
          file_pattern: { type: 'string', description: 'Glob like *.ts' },
          path: { type: 'string', default: '.' },
        },
        required: ['pattern'],
      },
    },
  },
];

export async function handleSearchTool(args) {
  const pattern = args.pattern;
  const filePattern = args.file_pattern || '*';
  const dir = args.path || '.';

  if (typeof pattern !== 'string' || pattern.length > 500) {
    return 'Error: invalid pattern';
  }

  // spawnSync with array args — no shell, zero injection surface
  const result = spawnSync(
    'grep',
    ['-rn', `--include=${filePattern}`, pattern, dir],
    { encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024 }
  );

  if (result.error) return `Search error: ${result.error.message}`;
  if (result.status === 1) return 'No matches found';
  if (result.status !== 0) return `grep exited with code ${result.status}`;

  return (result.stdout || '').slice(0, 10000) || 'No matches found';
}
