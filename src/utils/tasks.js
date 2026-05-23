/**
 * TaskListV2 — Dependency-aware task system for rxs-code v4
 *
 * AI outputs an <rxs-tasks> block that gets parsed into a live dependency graph.
 * Tasks can block each other; the system knows which ones are runnable vs waiting.
 *
 * XML format:
 *   <rxs-tasks>
 *   GOAL: Build authentication system
 *   [pending] setup:   Install packages
 *   [pending] schema:  Create User model    → needs: setup
 *   [running] routes:  Build auth routes    → needs: schema
 *   [done]    jwt:     Add JWT middleware   → needs: schema
 *   [failed]  tests:   Write tests          → needs: routes, jwt
 *   </rxs-tasks>
 *
 * Status values: pending | running | completed | failed
 * (AI may also write "done" — normalized to "completed")
 */

import chalk from 'chalk';

// ─── Task Status ──────────────────────────────────────────────────────────────

export const STATUS = {
  PENDING:   'pending',
  RUNNING:   'running',
  COMPLETED: 'completed',
  FAILED:    'failed',
};

function normalizeStatus(raw) {
  const s = (raw || '').toLowerCase().trim();
  if (s === 'done' || s === 'complete' || s === 'completed' || s === 'x') return STATUS.COMPLETED;
  if (s === 'running' || s === 'active' || s === 'in_progress')            return STATUS.RUNNING;
  if (s === 'failed'  || s === 'error'  || s === 'fail')                   return STATUS.FAILED;
  return STATUS.PENDING;
}

// ─── TaskListV2 Class ─────────────────────────────────────────────────────────

export class TaskListV2 {
  constructor(goal = '') {
    this.goal  = goal;
    this.tasks = new Map();   // id → { id, label, status, blockedBy: string[] }
    this.order = [];          // insertion order for display
  }

  /**
   * Add a task.
   * @param {string} id        — unique identifier (used in blockedBy refs)
   * @param {string} label     — human-readable label
   * @param {object} opts
   * @param {string[]} opts.blockedBy  — array of task ids that must complete first
   * @param {string}   opts.status     — initial status (default: pending)
   */
  add(id, label, { blockedBy = [], status = STATUS.PENDING } = {}) {
    this.tasks.set(id, { id, label, status, blockedBy });
    this.order.push(id);
    return this;
  }

  /** Update a task's status */
  setStatus(id, status) {
    const t = this.tasks.get(id);
    if (t) t.status = normalizeStatus(status);
    return this;
  }

  /** Returns tasks that can start right now (pending + all deps completed) */
  getRunnable() {
    return this.order
      .map(id => this.tasks.get(id))
      .filter(t => {
        if (t.status !== STATUS.PENDING) return false;
        return t.blockedBy.every(depId => {
          const dep = this.tasks.get(depId);
          return dep?.status === STATUS.COMPLETED;
        });
      });
  }

  /** True if all tasks are completed */
  isComplete() {
    return this.order.every(id => this.tasks.get(id)?.status === STATUS.COMPLETED);
  }

  /** Summary counts */
  summary() {
    let pending = 0, running = 0, completed = 0, failed = 0;
    for (const t of this.tasks.values()) {
      if (t.status === STATUS.PENDING)   pending++;
      if (t.status === STATUS.RUNNING)   running++;
      if (t.status === STATUS.COMPLETED) completed++;
      if (t.status === STATUS.FAILED)    failed++;
    }
    return { pending, running, completed, failed, total: this.tasks.size };
  }
}

// ─── XML Parser ───────────────────────────────────────────────────────────────
//
// Parses <rxs-tasks>…</rxs-tasks> blocks from AI responses.
// Returns a TaskListV2 or null if no valid block found.

export function parseTasksV2(text) {
  const match = text.match(/<rxs-tasks>([\s\S]*?)<\/rxs-tasks>/);
  if (!match) return null;

  const content  = match[1];
  const goalLine = content.match(/GOAL:\s*(.+)/);
  const goal     = goalLine ? goalLine[1].trim() : '';

  const tl = new TaskListV2(goal);

  // Each task line: [status] id: label → needs: dep1, dep2
  // The "→ needs:" part is optional
  const lineRe = /^\s*\[([^\]]+)\]\s+([\w-]+):\s+([^→\n]+?)(?:→\s*needs?:\s*(.+))?$/gm;
  let m;
  while ((m = lineRe.exec(content)) !== null) {
    const status    = normalizeStatus(m[1]);
    const id        = m[2].trim();
    const label     = m[3].trim();
    const depsRaw   = m[4] ? m[4].trim() : '';
    const blockedBy = depsRaw
      ? depsRaw.split(/[\s,]+/).map(d => d.trim()).filter(Boolean)
      : [];

    tl.add(id, label, { status, blockedBy });
  }

  return tl.tasks.size > 0 ? tl : null;
}

// ─── Visual Printer ───────────────────────────────────────────────────────────

/**
 * Print a TaskListV2 to stdout with:
 *   ✓  Setup packages               [done]
 *   ●  Create User model            [running]
 *   ⊠  Write tests                  [failed]
 *   ○  Build auth routes            [blocked: schema]
 *   ◌  Add JWT middleware           [ready]
 */
export function printTasksV2(tl) {
  if (!tl || tl.tasks.size === 0) return;

  console.log('');

  if (tl.goal) {
    console.log('  ' + chalk.hex('#a78bfa')('◈') + '  ' + chalk.dim('goal  ·  ') + chalk.white(tl.goal));
    console.log('');
  }

  const runnable = new Set(tl.getRunnable().map(t => t.id));

  for (const id of tl.order) {
    const t = tl.tasks.get(id);
    if (!t) continue;

    const { icon, labelFn, statusLabel } = _taskStyle(t, runnable.has(t.id));

    // Show deps if blocked
    let depsNote = '';
    if (t.status === STATUS.PENDING && t.blockedBy.length > 0 && !runnable.has(t.id)) {
      const depLabels = t.blockedBy
        .map(depId => tl.tasks.get(depId)?.label || depId)
        .join(', ');
      depsNote = chalk.dim('  ← ' + depLabels);
    }

    const labelText = labelFn(t.label.padEnd(36));
    console.log(`  ${icon}  ${labelText}${chalk.dim(statusLabel)}${depsNote}`);
  }

  // Summary line
  const s = tl.summary();
  const parts = [];
  if (s.completed) parts.push(chalk.hex('#4ade80')(s.completed + ' done'));
  if (s.running)   parts.push(chalk.hex('#a78bfa')(s.running   + ' running'));
  if (s.pending)   parts.push(chalk.dim(s.pending + ' pending'));
  if (s.failed)    parts.push(chalk.hex('#f87171')(s.failed    + ' failed'));

  if (parts.length) {
    console.log('');
    console.log('  ' + chalk.dim('─'.repeat(44)));
    console.log('  ' + parts.join(chalk.dim('  ·  ')));
  }

  console.log('');
}

function _taskStyle(t, isRunnable) {
  switch (t.status) {
    case STATUS.COMPLETED:
      return {
        icon:        chalk.hex('#4ade80')('✓'),
        labelFn:     s => chalk.dim(s),
        statusLabel: ' completed',
      };
    case STATUS.RUNNING:
      return {
        icon:        chalk.hex('#a78bfa')('●'),
        labelFn:     s => chalk.white(s),
        statusLabel: ' running…',
      };
    case STATUS.FAILED:
      return {
        icon:        chalk.hex('#f87171')('⊠'),
        labelFn:     s => chalk.hex('#f87171')(s),
        statusLabel: ' failed',
      };
    case STATUS.PENDING:
      if (isRunnable) {
        return {
          icon:        chalk.hex('#22d3ee')('◌'),
          labelFn:     s => chalk.white(s),
          statusLabel: ' ready',
        };
      }
      return {
        icon:        chalk.dim('○'),
        labelFn:     s => chalk.dim(s),
        statusLabel: ' blocked',
      };
    default:
      return {
        icon:        chalk.dim('○'),
        labelFn:     s => chalk.dim(s),
        statusLabel: '',
      };
  }
}

// ─── RXSCODE Protocol Extension ───────────────────────────────────────────────
// System prompt fragment to append when task V2 should be active

export const TASKS_V2_PROTOCOL = `

## TASK V2 PROTOCOL
For complex multi-step tasks with dependencies, use this format BEFORE writing code:

<rxs-tasks>
GOAL: [one-line goal]
[pending] id1: First task (no deps)
[pending] id2: Second task → needs: id1
[pending] id3: Third task  → needs: id1
[pending] id4: Final task  → needs: id2, id3
</rxs-tasks>

Rules:
- Task IDs: short lowercase with hyphens (e.g. "setup", "auth-routes", "write-tests")
- Status: pending | running | done | failed
- Use "→ needs: id1, id2" to declare dependencies (tasks that must complete first)
- Re-emit <rxs-tasks> block as tasks complete to show updated status
- Keep task labels concise (max ~40 chars)
- Only use this for tasks with 3+ steps or real dependencies; use <rxs-roadmap> for simple linear tasks
`;
