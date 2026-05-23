/**
 * git.js — Git integration for rxs-code
 * Wraps common git commands for use in CLI
 */

import { execSync, spawnSync } from 'child_process';

function run(cmd, cwd = process.cwd()) {
  try {
    const result = spawnSync('sh', ['-c', cmd], { cwd, encoding: 'utf8', timeout: 10000 });
    return { ok: result.status === 0, out: result.stdout?.trim() || '', err: result.stderr?.trim() || '' };
  } catch (e) {
    return { ok: false, out: '', err: e.message };
  }
}

/** Check if current dir is a git repo */
export function isGitRepo(cwd = process.cwd()) {
  const r = run('git rev-parse --git-dir 2>/dev/null', cwd);
  return r.ok;
}

/** Get short status (M, A, D, ? per file) */
export function gitStatus(cwd = process.cwd()) {
  const r = run('git status --short', cwd);
  return { ok: r.ok, output: r.out || r.err };
}

/** Get colored diff (staged or unstaged) */
export function gitDiff(staged = false, cwd = process.cwd()) {
  const flag = staged ? '--cached' : '';
  const r = run(`git diff ${flag} --stat`, cwd);
  const full = run(`git diff ${flag}`, cwd);
  return { ok: r.ok, stat: r.out, diff: full.out };
}

/** Stage files — '.' for all */
export function gitAdd(files = '.', cwd = process.cwd()) {
  return run(`git add ${files}`, cwd);
}

/** Commit with message */
export function gitCommit(message, cwd = process.cwd()) {
  const safe = message.replace(/"/g, '\\"');
  return run(`git commit -m "${safe}"`, cwd);
}

/** Push current branch */
export function gitPush(cwd = process.cwd()) {
  return run('git push', cwd);
}

/** Get current branch name */
export function gitBranch(cwd = process.cwd()) {
  const r = run('git branch --show-current', cwd);
  const all = run('git branch', cwd);
  return { ok: r.ok, current: r.out, all: all.out };
}

/** Create and switch to new branch */
export function gitCheckout(branch, create = false, cwd = process.cwd()) {
  const flag = create ? '-b ' : '';
  return run(`git checkout ${flag}${branch}`, cwd);
}

/** Get last N commits */
export function gitLog(n = 10, cwd = process.cwd()) {
  return run(`git log --oneline -${n}`, cwd);
}

/** Get repo remote URL */
export function gitRemote(cwd = process.cwd()) {
  return run('git remote get-url origin 2>/dev/null', cwd);
}

/** Full git info summary */
export function gitSummary(cwd = process.cwd()) {
  if (!isGitRepo(cwd)) return null;
  const branch  = gitBranch(cwd);
  const status  = gitStatus(cwd);
  const log     = gitLog(5, cwd);
  const remote  = gitRemote(cwd);
  return {
    branch:  branch.current,
    remote:  remote.out || '(no remote)',
    status:  status.output || '(clean)',
    recent:  log.out,
  };
}
