import fs from 'fs/promises';
import { existsSync } from 'fs';
import { glob } from 'glob';
import { spawnSync } from 'child_process';
import { estimateTokens } from '../utils/tokenizer.js';

export class ContextManager {
  constructor() {
    this.maxTokens = 8000;
    // REMOVED: .env.example — would send secrets to LLM on every request
    this.priorityFiles = ['package.json', 'README.md', 'tsconfig.json'];
  }

  async getRelevantFiles(userQuery) {
    const files = new Set();

    // Priority files
    for (const f of this.priorityFiles) {
      if (existsSync(f)) files.add(f);
    }

    // Recently modified via git — spawnSync with array args (no shell, no injection)
    try {
      const check = spawnSync('git', ['rev-parse', '--git-dir'], {
        encoding: 'utf8',
        timeout: 3000,
        stdio: 'pipe',
      });
      if (check.status === 0) {
        const diff = spawnSync(
          'git', ['diff', '--name-only', 'HEAD~1'],
          { encoding: 'utf8', timeout: 5000, stdio: 'pipe' }
        );
        if (diff.stdout) {
          diff.stdout.trim().split('\n').filter(Boolean).forEach(f => files.add(f));
        }
      }
    } catch {}

    const lower = userQuery.toLowerCase();
    if (/api|route|server/.test(lower)) {
      try {
        const apiFiles = await glob('**/{api,routes,app/api}/**/*.{js,ts,jsx,tsx}', {
          ignore: 'node_modules/**',
        });
        apiFiles.slice(0, 5).forEach(f => files.add(f));
      } catch {}
    }
    if (/component|ui|frontend|design/.test(lower)) {
      try {
        const compFiles = await glob('**/{components,ui}/**/*.{jsx,tsx}', {
          ignore: 'node_modules/**',
        });
        compFiles.slice(0, 5).forEach(f => files.add(f));
      } catch {}
    }

    return Array.from(files);
  }

  async readFiles(paths) {
    let content = '';
    let tokensUsed = 0;

    for (const file of paths) {
      if (!existsSync(file)) continue;
      try {
        const fileContent = await fs.readFile(file, 'utf8');
        const ftokens = estimateTokens(fileContent);
        if (tokensUsed + ftokens > this.maxTokens) {
          content += `\n<file path="${file}" truncated="token_limit" />\n`;
          break;
        }
        content += `\n<file path="${file}">\n${fileContent}\n</file>`;
        tokensUsed += ftokens;
      } catch {}
    }

    return content;
  }
}
