import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export const shellTools = [
  {
    type: 'function',
    function: {
      name: 'execute_command',
      description: 'Run a shell command in the project directory',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string' },
          workdir: { type: 'string', description: 'Working directory (relative to project root)' },
        },
        required: ['command'],
      },
    },
  },
];

const BLOCKED = [
  /rm\s+-rf\s+\//,
  /sudo\s+rm/,
  /mkfs/,
  /dd\s+if=/,
  />\s*\/dev\/sd/,
  /:\s*\(\s*\)\s*\{/,   // fork bomb
  /chmod\s+[0-7]*7\s+\//,
  /curl[^|]+\|\s*(ba)?sh/,
  /wget[^|]+\|\s*(ba)?sh/,
];

export async function handleShellTool(args, context) {
  const cmd = args.command;
  const cwd = args.workdir ? `${context.cwd}/${args.workdir}` : context.cwd;

  for (const pattern of BLOCKED) {
    if (pattern.test(cmd)) {
      return `Command blocked (dangerous pattern matched): ${cmd}`;
    }
  }

  try {
    const { stdout, stderr } = await execAsync(cmd, {
      cwd,
      timeout: 30000,
      maxBuffer: 1024 * 1024,
    });
    return stdout || stderr || '(no output)';
  } catch (e) {
    return `Exit ${e.code}\n${e.stderr || e.stdout || e.message || ''}`;
  }
}
