import { spawnSync } from 'child_process';
import chalk from 'chalk';

// No shell involved — text piped via stdin, not interpolated into command string
export function copyToClipboard(text) {
  try {
    const result = spawnSync('termux-clipboard-set', [], {
      input: text,
      encoding: 'utf8',
      timeout: 3000,
    });
    if (result.status === 0) {
      console.log(chalk.dim('(Copied to clipboard)'));
    }
  } catch {
    // Not in Termux or termux-api not installed
  }
}

export function notify(title, message) {
  try {
    // Args as array — no shell interpolation, no injection
    spawnSync('termux-notification', ['--title', title, '--content', message], {
      encoding: 'utf8',
      timeout: 3000,
    });
  } catch {}
}
