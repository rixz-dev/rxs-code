import { createProvider, getAvailableProviders, getApiKeyForProvider } from './provider-factory.js';
import { ContextManager } from './context.js';
import { allTools, executeTool } from '../tools/index.js';
import { ASK_USER_SENTINEL } from '../tools/ask-user.js';
import { detectSkills } from '../skills/index.js';
import { buildSystemPrompt } from '../prompts/system.js';
import { estimateTokens, truncateToBudget } from '../utils/tokenizer.js';
import { promptCache } from '../utils/cache.js';
import { SessionManager } from '../utils/session.js';
import { ModelCatalog } from '../utils/model-catalog.js';
import { getConfig, resetConfig } from '../utils/config.js';
import { isRetryableError } from '../utils/retry.js';
import {
  parseTokenBudget, BudgetTracker, formatBudgetStatus,
  MAX_OUTPUT_TOKENS_RECOVERY_LIMIT, buildRecoveryMessage,
} from './token-budget.js';
import {
  microCompactMessages, autoCompactMessages,
  estimateContextChars, getContextWarningState,
  AUTOCOMPACT_THRESHOLD_CHARS,
} from './context-manager.js';
import {
  checkFileState, cacheFileRead, invalidateFile,
  FILE_UNCHANGED_STUB, getCacheStats, clearCache,
} from './file-state-cache.js';
import { loadMemoryPrompt, appendMemory, readMemory } from './memory.js';
import {
  C, getWidth, printBanner, printUserBox, printAIHeader, printAILine,
  printAIFooter, printErrorBox, printInfoBox, printToolBadge,
  printAutoContinueBadge, printRetryBadge, printRoadmapStatus,
  parseRoadmap, buildRoadmapContinuePrompt, createSpinner,
  modelSelector, saveModelHistory,
  stopActiveSpinner,
  streamChunk,
  streamFlush,
  printAIFooterLine,
} from '../utils/ui.js';
import chalk from 'chalk';
import readline from 'readline/promises';
import { readFileSync } from 'fs';
import { resolve } from 'path';

function fuzzyMatchProvider(input, providers) {
  const q = input.toLowerCase().replace(/\s/g, '');
  // exact match first
  const exact = providers.find(p => p.toLowerCase() === q);
  if (exact) return exact;
  // prefix match
  const prefix = providers.find(p => p.toLowerCase().startsWith(q));
  if (prefix) return prefix;
  // contains match
  const contains = providers.find(p => p.toLowerCase().includes(q));
  if (contains) return contains;
  // levenshtein ≤2
  function lev(a, b) {
    const m = Array.from({length: a.length+1}, (_,i) =>
      Array.from({length: b.length+1}, (_,j) => i||j ? (i&&j ? 0 : i||j) : 0)
    );
    for (let i=1;i<=a.length;i++) for (let j=1;j<=b.length;j++)
      m[i][j] = a[i-1]===b[j-1] ? m[i-1][j-1] : 1+Math.min(m[i-1][j],m[i][j-1],m[i-1][j-1]);
    return m[a.length][b.length];
  }
  const close = providers
    .map(p => ({ p, d: lev(q, p.toLowerCase()) }))
    .filter(x => x.d <= 2)
    .sort((a,b) => a.d - b.d)[0];
  return close?.p || null;
}


const pkg = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../package.json'), 'utf8'));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const MAX_AUTO_CONTINUE = 4;

// ─── Permission System ────────────────────────────────────────────────────────

// Tools that always need confirmation
const ALWAYS_CONFIRM = new Set(['execute_command']);

// Tools that need confirmation only in certain conditions
const WRITE_TOOLS = new Set(['write_file', 'edit_file', 'create_file']);

// Per-session allow cache: key = "toolName:pattern" → true
const _permissionCache = new Set();

function requiresPermission(toolName, toolArgs, state) {
  // Shell: always confirm unless cached
  if (ALWAYS_CONFIRM.has(toolName)) {
    const key = `${toolName}:${toolArgs.command || ''}`;
    if (_permissionCache.has(key)) return false;
    return true;
  }
  // Write tools: confirm if autoConfirmWrites is off
  if (WRITE_TOOLS.has(toolName)) {
    if (state.autoConfirmWrites) return false;
    return true;
  }
  return false;
}

async function askPermission(toolName, toolArgs, rl) {
  const detail =
    toolArgs.command || toolArgs.path || toolArgs.pattern || '';
  const label =
    toolName === 'execute_command' ? `$ ${detail}` :
    toolName === 'write_file'      ? `write → ${detail}` :
    toolName === 'edit_file'       ? `edit  → ${detail}` :
    toolName === 'create_file'     ? `new   → ${detail}` : toolName;

  process.stdout.write(
    `\n  ${C.warn('⚠')}  Allow ${C.white(label)} ?  ` +
    C.dim('[y]es  [n]o  [a]lways  [q]uit session  ❯ ')
  );
  const ans = (await rl.question('')).trim().toLowerCase();

  if (ans === 'q') {
    console.log(C.dim('\n  Session ended by user.'));
    process.exit(0);
  }
  if (ans === 'a') {
    // Cache this tool+command for the rest of the session
    const key = `${toolName}:${detail}`;
    _permissionCache.add(key);
    // Also auto-confirm all writes if user chose 'a' on a write tool
    return true;
  }
  return ans === 'y' || ans === 'yes' || ans === '';
}

// ─── Roadmap system prompt addition ──────────────────────────────────────────
const ROADMAP_PROTOCOL = `
## TASK EXECUTION PROTOCOL
For any task involving multiple files, building a system, or multi-step implementation:

1. Begin with a roadmap block BEFORE writing any code:
<rxs-roadmap>
GOAL: [one-line goal]
[ ] 1. [step one]
[ ] 2. [step two]
[ ] 3. [step three]
</rxs-roadmap>

2. As steps complete, update the roadmap marking them [x]:
<rxs-roadmap>
GOAL: [goal]
[x] 1. [done step]
[ ] 2. [next step]
</rxs-roadmap>

3. After any interruption, IMMEDIATELY show the current roadmap status with [x] on completed steps, then resume from the first [ ] step without repeating anything already written.
`;

// ─── Streaming Engine ─────────────────────────────────────────────────────────

async function streamWithAutoContinue(provider, baseParams, stateRef) {
  let autoContinues            = 0;
  let maxTokensRecoveryCount   = 0;
  let currentParams            = { ...baseParams, messages: [...baseParams.messages] };
  let accumulated              = '';

  // Token budget tracker (set by caller via stateRef.budgetTracker)
  const budgetTracker = stateRef?.budgetTracker || null;

  while (true) {
    let partial      = '';
    let toolCalls    = null;
    let finishReason = null;
    let err          = null;

    try {
      for await (const chunk of provider.stream(currentParams)) {
        if (chunk.type === 'text') {
          streamChunk(chunk.content);
          partial += chunk.content;
        }
        if (chunk.type === 'thinking') {
          process.stdout.write(C.dim('·'));
        }
        if (chunk.type === 'thinking_end') {
          process.stdout.write('\n');
          process.stdout.write(C.ai('│') + '  ');
        }
        if (chunk.type === 'tool_calls') {
          toolCalls    = chunk.content;
          partial      = chunk.fullContent || partial;
          finishReason = 'tool_calls';
        }
        if (chunk.type === 'finish') {
          finishReason = chunk.reason;
        }
      }
      streamFlush();
      printAIFooterLine();
      accumulated += partial;

      // Parse & store roadmap
      const roadmap = parseRoadmap(accumulated);
      if (roadmap && stateRef) stateRef.roadmap = roadmap;

      // ── max_output_tokens recovery ────────────────────────────────────────
      // finish_reason === 'length' means AI was cut off mid-response
      if (finishReason === 'length' || finishReason === 'max_tokens') {
        if (maxTokensRecoveryCount < MAX_OUTPUT_TOKENS_RECOVERY_LIMIT) {
          maxTokensRecoveryCount++;
          const recoveryMsg = buildRecoveryMessage(maxTokensRecoveryCount);

          console.log(C.dim(
            `\n  ↻  [output limit hit — recovery ${maxTokensRecoveryCount}/${MAX_OUTPUT_TOKENS_RECOVERY_LIMIT}]`
          ));

          currentParams = {
            ...baseParams,
            messages: [
              ...currentParams.messages,
              { role: 'assistant', content: accumulated },
              { role: 'user',      content: recoveryMsg },
            ],
          };
          printAIHeader(provider.name, currentParams.model || provider.defaultModel);
          continue;  // ← loop lagi, AI sambung dari tengah
        }
        // Exhausted recovery — surface warning and return
        console.log(C.warn(`\n  ⚠  Output limit hit ${MAX_OUTPUT_TOKENS_RECOVERY_LIMIT}x — response may be incomplete.`));
      }

      // ── Token budget continuation ─────────────────────────────────────────
      // Kalau user set budget ("+500k") dan AI selesai normal, cek budget
      if (budgetTracker && !toolCalls) {
        const decision = budgetTracker.check(accumulated.length);

        if (decision.action === 'continue') {
          console.log(C.dim(`\n  ↻  [budget: ${formatBudgetStatus(budgetTracker)}]`));
          currentParams = {
            ...baseParams,
            messages: [
              ...currentParams.messages,
              { role: 'assistant', content: accumulated },
              { role: 'user',      content: decision.nudgeMessage },
            ],
          };
          printAIHeader(provider.name, currentParams.model || provider.defaultModel);
          continue;  // ← AI terus kerja
        }

        if (decision.stats?.continuationCount > 0) {
          console.log(C.dim(`\n  ✓  Budget done: ${formatBudgetStatus(budgetTracker)}`));
        }
      }

      return { response: accumulated, toolCalls };

    } catch (e) {
      err = e;
      streamFlush();
      printAIFooterLine();
      accumulated += partial;
    }

    // ── Network/API error retry ───────────────────────────────────────────────
    const retryable  = isRetryableError(err);
    const hasContent = accumulated.trim().length > 30;

    if (!retryable || autoContinues >= MAX_AUTO_CONTINUE) {
      process.stdout.write(C.error(`\n\n  ✖  ${err?.message || String(err)}`));
      return { response: accumulated, toolCalls: null };
    }

    autoContinues++;

    if (hasContent) {
      printAutoContinueBadge(autoContinues, MAX_AUTO_CONTINUE);
      const roadmap     = stateRef?.roadmap || parseRoadmap(accumulated);
      const continueMsg = buildRoadmapContinuePrompt(roadmap);

      currentParams = {
        ...baseParams,
        messages: [
          ...currentParams.messages,
          { role: 'assistant', content: accumulated },
          { role: 'user',      content: continueMsg },
        ],
      };
      printAIHeader(provider.name, currentParams.model || provider.defaultModel);
    } else {
      const delay = 1500 * autoContinues;
      printRetryBadge(autoContinues, MAX_AUTO_CONTINUE, delay);
      await sleep(delay);
    }
  }
}

// ─── Commands ─────────────────────────────────────────────────────────────────

async function handleCommand(raw, state, rl) {
  const [cmd, ...args] = raw.slice(1).trim().split(/\s+/);
  const ask = (q) => { process.stdout.write(q); return rl.question(''); };

  switch (cmd) {

    case 'help': {
      const w = getWidth();
      const lines = [
        '/help                   Show this help',
        '/provider <name>        Switch provider',
        '/model [id]             Set or pick model interactively',
        '/models                 List all available models',
        '/thinking <level>       off | low | medium | high | max',
        '/skills                 Show active skills',
        '/status                 Provider + model + token info',
        '/roadmap                Show current task roadmap',
        '/todos                  Show session task list',
        '/trust                  Toggle auto-approve writes',
        '/remember <text>        Save note to MEMORY.md',
        '/memory                 Show current MEMORY.md',
        '/budget                 Show token budget status',
        '/compact                Force compact on next message',
        '/cache                  Show file cache stats',
        '/clear                  Clear conversation history',
        '/save [name]            Save session',
        '/load [name]            Load saved session',
        '/tokens                 Token usage bar',
        '/refresh                Refresh model catalog cache',
        '/continue               Manual continue after interruption',
        '/doctor                 Run environment & API key diagnostics',
        '/theme [name]           Set UI theme  dark|cyber|amoled|matrix|amber',
        '/git                    Show git status & recent commits',
        '/cost                   Show session token cost estimate',
        '/undo                   Remove last exchange from history',
        '/export [name]          Export conversation to markdown file',
        'exit                    Quit',
      ];
      printInfoBox(lines.join('\n'), 'COMMANDS');
      return state;
    }

    case 'provider': {
      const target = args[0];
      const available = getAvailableProviders();
      if (!target || !available.includes(target)) {
        printInfoBox('Available: ' + available.join('  ·  '), 'PROVIDERS');
        return state;
      }
      const apiKey = getApiKeyForProvider(target);
      if (!apiKey) {
        printErrorBox(`No API key for "${target}". Add to .env`);
        return state;
      }
      const spinner = createSpinner('connecting');
      try {
        const p = await createProvider(target, { apiKey });
        await p.validate();
        spinner.stop();
        state.provider = p;
        state.model    = await modelSelector(p, p.defaultModel, rl);
        state.thinking = 'off';
        state.history  = [];
        state.roadmap  = null;
        const cfg = getConfig();
        printBanner(p.name, state.model, { ...cfg, version: pkg.version });
      } catch (e) {
        spinner.stop();
        printErrorBox(e.message);
      }
      return state;
    }

    case 'model': {
      const id = args[0];
      if (id) {
        state.model = id;
        await saveModelHistory(state.provider.name, id);
        console.log(C.success(`  ✓  Model: ${id}`));
      } else {
        // Interactive picker
        const _msel = await modelSelector(state.provider, state.model, rl);
const _mselResult = typeof _msel === 'object' && _msel?.passthrough ? _msel : { model: _msel, passthrough: null };
state.model = _mselResult.model;
if (_mselResult.passthrough) {
  await handleCommand(_mselResult.passthrough, state, rl);
}
        console.log(C.success(`  ✓  Model: ${state.model}`));
      }
      return state;
    }

    case 'models': {
      const spinner = createSpinner('loading');
      try {
        const catalog = new ModelCatalog();
        const models  = await catalog.getModels(state.provider, state.provider.name);
        spinner.stop();
        const lines = models.slice(0, 40).map((m, i) => {
          const cur = m.id === state.model ? C.success(' ●') : '  ';
          const ctx = m.contextWindow ? C.dim(` ${Math.round(m.contextWindow / 1000)}K`) : '';
          return `${cur} ${i + 1 < 10 ? ' ' : ''}${i + 1}.  ${m.id}${ctx}`;
        });
        if (models.length > 40) lines.push(C.dim(`  ... and ${models.length - 40} more`));
        printInfoBox(lines.join('\n'), 'MODELS  ·  ' + state.provider.name.toUpperCase());
      } catch (e) {
        spinner.stop();
        printErrorBox(e.message);
      }
      return state;
    }

    case 'thinking': {
      const levels = ['off', 'low', 'medium', 'high', 'max'];
      const lvl = args[0];
      if (!lvl || !levels.includes(lvl)) {
        printInfoBox(`Current: ${state.thinking}\nOptions: ${levels.join('  ·  ')}`, 'THINKING');
        return state;
      }
      if (!state.provider.supportsThinking && lvl !== 'off') {
        printErrorBox(`${state.provider.name} does not support thinking mode.`);
        return state;
      }
      state.thinking = lvl;
      console.log(C.success(`  ✓  Thinking: ${lvl}`));
      return state;
    }

    case 'roadmap': {
      if (!state.roadmap) {
        printInfoBox('No roadmap in current session. Start a complex task to generate one.', 'ROADMAP');
      } else {
        printRoadmapStatus(state.roadmap);
      }
      return state;
    }

    case 'status': {
      const cfg = getConfig();
      const est = estimateTokens(JSON.stringify(state.history));
      const pct = ((est / cfg.maxContextTokens) * 100).toFixed(1);
      const bar = buildTokenBar(est, cfg.maxContextTokens, 24);
      const lines = [
        `Provider    ${state.provider.name.toUpperCase()}`,
        `Model       ${state.model}`,
        `Thinking    ${state.thinking}`,
        `History     ${state.history.length} messages`,
        `Tokens      ${bar}  ${est}/${cfg.maxContextTokens}  (${pct}%)`,
        `Roadmap     ${state.roadmap ? state.roadmap.goal : 'none'}`,
      ];
      printInfoBox(lines.join('\n'), 'STATUS');
      return state;
    }

    case 'tokens': {
      const cfg = getConfig();
      const est = estimateTokens(JSON.stringify(state.history));
      const bar = buildTokenBar(est, cfg.maxContextTokens, 30);
      console.log(`\n  ${bar}  ${C.white(est + '/' + cfg.maxContextTokens)}\n`);
      return state;
    }

    case 'clear':
      state.history = [];
      state.roadmap = null;
      console.log(C.dim('  ✓  Conversation cleared.'));
      return state;

    case 'save': {
      const name = args[0] || 'default';
      await new SessionManager(name).save(state.history);
      console.log(C.success(`  ✓  Session saved as "${name}".`));
      return state;
    }

    case 'load': {
      const name = args[0] || 'default';
      const loaded = await new SessionManager(name).load();
      state.history = loaded || [];
      state.roadmap = null;
      console.log(C.success(`  ✓  Loaded ${state.history.length} messages from "${name}".`));
      return state;
    }

    case 'skills':
      printInfoBox(
        state.activeSkills.length
          ? state.activeSkills.map(s => `  ◆  ${s.name}`).join('\n')
          : '  No skills active.',
        'SKILLS'
      );
      return state;

    case 'refresh': {
      const catalog = new ModelCatalog();
      await catalog.invalidate(state.provider.name);
      console.log(C.success('  ✓  Model catalog cache cleared.'));
      return state;
    }

    case 'continue': {
      if (!state.lastPartial) {
        printInfoBox('No interrupted response to continue.', 'CONTINUE');
        return state;
      }
      state._manualContinue = buildRoadmapContinuePrompt(state.roadmap);
      console.log(C.warn('  ↻  Manual continue queued — send any message to trigger.'));
      return state;
    }

    case 'remember': {
      const content = args.join(' ');
      if (!content.trim()) {
        printInfoBox('Usage: /remember <text to save to MEMORY.md>', 'REMEMBER');
        return state;
      }
      try {
        const path = await appendMemory(process.cwd(), content);
        console.log(C.success(`  ✓  Saved to ${path}`));
      } catch (e) {
        printErrorBox(`Failed to save memory: ${e.message}`);
      }
      return state;
    }

    case 'memory': {
      const mem = await readMemory(process.cwd());
      if (!mem) {
        printInfoBox('No MEMORY.md found in current directory.', 'MEMORY');
        return state;
      }
      printInfoBox(mem.slice(0, 1200) + (mem.length > 1200 ? '\n...(truncated)' : ''), 'MEMORY.md');
      return state;
    }

    case 'budget': {
      if (!state.budgetTracker) {
        printInfoBox(
          'No active token budget.\nSet one with: "+500k", "+2m", or "use 1M tokens" in your message.',
          'TOKEN BUDGET'
        );
        return state;
      }
      printInfoBox(formatBudgetStatus(state.budgetTracker), 'TOKEN BUDGET');
      return state;
    }

    case 'compact': {
      // Manual compact trigger
      const allMsgs = [{ role: 'system', content: '...' }]; // placeholder
      console.log(C.dim('  🗜  Compacting conversation...'));
      // actual messages are not accessible from command handler — set flag
      state._forceCompact = true;
      console.log(C.warn('  ↻  Compact will run on next message.'));
      return state;
    }

    case 'cache': {
      const stats = getCacheStats();
      const bar = Math.round(stats.usedPercent / 10);
      printInfoBox(
        `Files cached : ${stats.entries} / ${stats.maxEntries}\n` +
        `Memory used  : ${Math.round(stats.bytes / 1024)}KB / ${Math.round(stats.maxBytes / 1024 / 1024)}MB\n` +
        `Usage        : [${'█'.repeat(bar)}${'░'.repeat(10-bar)}] ${stats.usedPercent}%`,
        'FILE CACHE'
      );
      return state;
    }

    case 'trust': {
      state.autoConfirmWrites = !state.autoConfirmWrites;
      const status = state.autoConfirmWrites ? 'ON  (writes auto-approved)' : 'OFF (writes need confirmation)';
      console.log(C.success(`  ✓  Auto-confirm writes: ${status}`));
      return state;
    }

    case 'todos': {
      const { getTodos } = await import('../tools/todo.js');
      const todos = getTodos();
      if (!todos.length) {
        printInfoBox('No todos in current session.', 'TODOS');
        return state;
      }
      const pending     = todos.filter(t => t.status === 'pending');
      const in_progress = todos.filter(t => t.status === 'in_progress');
      const done        = todos.filter(t => t.status === 'done');
      const fmt = t => {
        const icon = t.status === 'done' ? C.success('✓') : t.status === 'in_progress' ? C.warn('▶') : C.dim('○');
        return `  ${icon}  ${t.content}`;
      };
      const lines = [];
      if (in_progress.length) { lines.push(C.warn('  IN PROGRESS')); lines.push(...in_progress.map(fmt)); }
      if (pending.length)     { lines.push(C.dim('  PENDING'));      lines.push(...pending.map(fmt)); }
      if (done.length)        { lines.push(C.success('  DONE'));      lines.push(...done.map(fmt)); }
      printInfoBox(lines.join('\n'), `TODOS  ·  ${todos.length} tasks`);
      return state;
    }

    case 'doctor': {
      const spinner = createSpinner('connecting');
      try {
        const { runDoctor, runProviderHealthCheck } = await import('../utils/doctor.js');
        const [checks, health] = await Promise.all([runDoctor(), runProviderHealthCheck()]);
        spinner.stop();
        const lines = checks.map(c => {
          const icon   = c.ok ? C.success('✓') : C.error('✗');
          const detail = c.detail ? C.dim('  ' + c.detail) : '';
          const fix    = (!c.ok && c.fix) ? '\n    ' + C.warn('→ ' + c.fix) : '';
          return `  ${icon}  ${c.label}${detail}${fix}`;
        });
        if (health.length) {
          lines.push('');
          lines.push(C.dim('  PROVIDER HEALTH'));
          health.forEach(h => {
            const icon   = h.ok ? C.success('✓') : C.error('✗');
            const ms     = h.ms != null ? C.dim(`  ${h.ms}ms`) : '';
            const reason = !h.ok ? '  ' + C.warn(`(${h.reason})`) : '';
            lines.push(`  ${icon}  ${h.name.padEnd(12)}${ms}${reason}`);
          });
        }
        printInfoBox(lines.join('\n'), 'DOCTOR');
      } catch (e) {
        spinner.stop();
        printErrorBox(e.message);
      }
      return state;
    }

    case 'theme': {
      const { listThemes, saveTheme } = await import('../utils/themes.js');
      const themeName = args[0];
      const themes    = listThemes();
      if (!themeName) {
        const lines = themes.map(t => {
          const cur = t.active ? C.success(' ●') : '  ';
          return `${cur} ${t.name.padEnd(10)}  ${C.dim(t.description)}`;
        });
        lines.push('');
        lines.push(C.dim('  Usage: /theme <name>'));
        printInfoBox(lines.join('\n'), 'THEMES');
        return state;
      }
      try {
        saveTheme(themeName);
        console.log(C.success(`  ✓  Theme set: ${themeName}`));
        console.log(C.dim('  ↻  Restart rxs-code to apply.'));
      } catch (e) {
        printErrorBox(e.message + '  ·  Available: ' + themes.map(t => t.name).join(', '));
      }
      return state;
    }

    case 'git': {
      const { gitSummary } = await import('../utils/git.js');
      const summary = gitSummary(process.cwd());
      if (!summary) {
        printInfoBox('Not a git repository.', 'GIT');
        return state;
      }
      const statusLines = summary.status.split('\n').filter(Boolean).map(l => '  ' + l).join('\n') || '  (clean)';
      const logLines    = summary.recent.split('\n').filter(Boolean).map(l => '  ' + l).join('\n') || '  (no commits)';
      const lines = [
        `Branch   ${C.white(summary.branch)}`,
        `Remote   ${C.dim(summary.remote)}`,
        '',
        C.dim('  STATUS'),
        statusLines,
        '',
        C.dim('  RECENT COMMITS'),
        logLines,
      ];
      printInfoBox(lines.join('\n'), 'GIT');
      return state;
    }

    case 'cost': {
      const { CostTracker } = await import('../utils/cost.js');
      const histEst = estimateTokens(JSON.stringify(state.history));
      // Conversation split: ~55% input (repeated context), ~45% output
      const tracker = new CostTracker();
      tracker.record(Math.round(histEst * 0.55), Math.round(histEst * 0.45), state.model);
      tracker.turns = Math.floor(state.history.length / 2);
      const s      = tracker.summary(state.model);
      const fmt    = n => new Intl.NumberFormat('en-US').format(n);
      const fmtUSD = n => n < 0.001 ? `<$0.001` : `$${n.toFixed(4)}`;
      const lines  = [
        `Model     ${s.model}`,
        `Turns     ${s.turns}`,
        ``,
        `Tokens    ~${fmt(s.totalTokens)}  (estimated)`,
        `  Input   ${fmt(s.inputTokens)}  @ $${s.priceTable.input}/M`,
        `  Output  ${fmt(s.outputTokens)}  @ $${s.priceTable.output}/M`,
        ``,
        `Cost est  ${C.white(fmtUSD(s.costUSD))}`,
        `Duration  ${s.duration}`,
        ``,
        C.dim('  * Rough estimate — actual billed tokens depend on provider'),
      ];
      printInfoBox(lines.join('\n'), 'SESSION COST');
      return state;
    }

    case 'undo': {
      if (state.history.length < 2) {
        printInfoBox('Nothing to undo.', 'UNDO');
        return state;
      }
      const removed  = state.history.splice(-2, 2);
      const preview  = String(removed[0]?.content || '').slice(0, 60);
      console.log(C.success(`  ✓  Undone: "${preview}${preview.length === 60 ? '...' : ''}"`));
      const _session = new SessionManager('default');
      await _session.save(state.history);
      return state;
    }

    case 'export': {
      const { writeFileSync } = await import('fs');
      const exportName = (args[0] || `rxs-export-${Date.now()}`);
      const filename   = exportName.endsWith('.md') ? exportName : `${exportName}.md`;
      const chunks     = [
        `# rxs-code Export\n`,
        `**Date:** ${new Date().toISOString()}`,
        `**Model:** ${state.model}`,
        `**Provider:** ${state.provider.name}`,
        `**Messages:** ${Math.floor(state.history.length / 2)} turns\n`,
        `---\n`,
      ];
      for (const msg of state.history) {
        if (msg.role === 'user') {
          chunks.push(`## User\n\n${msg.content}\n`);
        } else if (msg.role === 'assistant') {
          chunks.push(`## Assistant\n\n${msg.content}\n`);
        }
      }
      try {
        writeFileSync(filename, chunks.join('\n'), 'utf8');
        console.log(C.success(`  ✓  Exported → ${filename}  (${Math.floor(state.history.length / 2)} turns)`));
      } catch (e) {
        printErrorBox(`Export failed: ${e.message}`);
      }
      return state;
    }

    default:
      printErrorBox(`Unknown command: /${cmd}\nType /help for available commands.`);
      return state;
  }
}

// ─── Token Bar ────────────────────────────────────────────────────────────────

function buildTokenBar(used, max, len = 20) {
  const filled = Math.min(Math.round((used / max) * len), len);
  const pct    = used / max;
  const color  = pct > 0.85 ? C.error : pct > 0.60 ? C.warn : C.success;
  return C.dim('[') + color('█'.repeat(filled)) + C.dim('░'.repeat(len - filled)) + C.dim(']');
}

// ─── Main Interactive Loop ────────────────────────────────────────────────────

export async function startInteractive() {
  const config = getConfig();

  // ── Startup spinner ────────────────────────────────────────────────────────
  const initSpinner = createSpinner('connecting');
  const provider = await createProvider(config.provider, { apiKey: config.apiKey });
  try {
    await provider.validate();
  } catch (e) {
    initSpinner.stop();
    printErrorBox(`Provider validation failed: ${e.message}`);
    process.exit(1);
  }
  initSpinner.stop();

  // ── Model selection ────────────────────────────────────────────────────────
  const rl = readline.createInterface({
    input: process.stdin, output: process.stdout, terminal: true,
  });

  let model = config.model === 'auto' ? provider.defaultModel : config.model;
  model = await modelSelector(provider, model, rl);
  await saveModelHistory(provider.name, model);

  let state = {
    provider,
    model,
    thinking:          'off',
    history:           [],
    activeSkills:      [],
    roadmap:           null,
    lastPartial:       '',
    _manualContinue:   null,
    autoConfirmWrites: false,  // set true by /trust command
  };

  printBanner(provider.name, model, { ...config, version: pkg.version });

  // ── Load previous session ─────────────────────────────────────────────────
  const session = new SessionManager('default');
  const saved   = await session.load();
  if (saved.length) {
    state.history = saved;
    console.log(C.dim(`  ↺  Session restored  ·  ${saved.length} messages`));
  }

  // ── Load memory files (CLAUDE.md / MEMORY.md) ─────────────────────────────
  const memoryPrompt = await loadMemoryPrompt(process.cwd());
  if (memoryPrompt) {
    console.log(C.dim(`  🧠  Memory loaded`));
  }

  // ── Clear file cache for fresh session ───────────────────────────────────
  clearCache();

  const context = new ContextManager();

  // ── REPL ──────────────────────────────────────────────────────────────────
  while (true) {
    process.stdout.write(C.orange('\n  ❯  '));
    let rawInput;
    try { rawInput = await rl.question(''); } catch { break; }
    if (!rawInput.trim()) continue;
    if (rawInput.toLowerCase() === 'exit') break;

    // Slash command
    if (rawInput.startsWith('/')) {
      state = await handleCommand(rawInput, state, rl);
      continue;
    }

    // Manual continue override
    let userInput = rawInput;
    if (state._manualContinue) {
      userInput = state._manualContinue;
      state._manualContinue = null;
    }

    // Render user message
    printUserBox(userInput);

    // Skill detection
    const detected = detectSkills(userInput);
    if (detected.length) {
      state.activeSkills = detected;
      console.log(C.dim(`  ◈  Skills: ${detected.map(s => s.name).join('  ·  ')}`));
    }

    // Context gathering
    const relevantFiles = await context.getRelevantFiles(userInput);
    let ctxContent = '';
    if (relevantFiles.length) {
      console.log(C.dim(`  ◈  Context: ${relevantFiles.slice(0, 3).join('  ')}`));
      ctxContent = await context.readFiles(relevantFiles);
    }

    // System prompt with roadmap protocol
    const cacheKey = `sys_${state.provider.name}_${state.activeSkills.map(s => s.name).sort().join('_')}`;
    let systemPrompt = await promptCache.get(cacheKey);
    if (!systemPrompt) {
      systemPrompt = buildSystemPrompt(state.activeSkills)
        + state.provider.getSystemPromptAppendix()
        + ROADMAP_PROTOCOL;
      await promptCache.set(cacheKey, systemPrompt);
    }

    const userContent = ctxContent
      ? `${userInput}\n\n<project-context>\n${ctxContent}\n</project-context>`
      : userInput;


    // Inject memory (per-session, not in promptCache)
    const activeSystemPrompt = memoryPrompt
      ? systemPrompt + '\n\n' + memoryPrompt
      : systemPrompt;

    // Token budget: detect "+500k" / "use 2M tokens" in user message
    const parsedBudget = parseTokenBudget(userInput);
    if (parsedBudget) {
      state.budgetTracker = new BudgetTracker(parsedBudget);
      const _fmt = n => new Intl.NumberFormat('en-US').format(n);
      console.log(C.dim('  budget  Token budget set: ' + _fmt(parsedBudget) + ' tokens'));
    } else if (state.budgetTracker && state.budgetTracker.pct >= 90) {
      state.budgetTracker = null;
    }
    const messages = [
      { role: 'system', content: activeSystemPrompt },
      ...state.history,
      { role: 'user', content: userContent },
    ];

    // Token budget management
    const totalEst = estimateTokens(JSON.stringify(messages));
    if (totalEst > config.maxContextTokens) {
      console.log(C.dim('  ⟳  Trimming history to fit context window...'));
      state.history = truncateToBudget(
        state.history,
        config.maxContextTokens,
        estimateTokens(systemPrompt),
      );
      messages.splice(1, messages.length - 2, ...state.history);
    }

    // ── AutoCompact: check context size before each turn ─────────────────────
    {
      const ctxChars = estimateContextChars(messages);
      const warning  = getContextWarningState(ctxChars);
      if (warning.isAboveThreshold) {
        console.log(C.warn(`  🗜  Context ${warning.percentUsed}% full — auto-compacting...`));
        try {
          const compacted = await autoCompactMessages(messages, state.provider, state.model);
          messages.splice(0, messages.length, ...compacted.messages);
          console.log(C.dim(
            `  ✓  Compacted: ${compacted.originalLength} → ${messages.length} messages`
          ));
        } catch (e) {
          // Compact failed — try microcompact as fallback
          console.log(C.dim(`  ⟳  Full compact failed, trying micro-compact...`));
          const micro = microCompactMessages(messages);
          if (micro.compacted) {
            messages.splice(0, messages.length, ...micro.messages);
            console.log(C.dim(`  ✓  Micro-compacted: freed ${Math.round(micro.freed / 1024)}KB`));
          }
        }
      } else if (warning.isAboveWarning) {
        console.log(C.dim(`  ⚠  Context ${warning.percentUsed}% — compaction soon`));
      }
    }

    // ── Generation ────────────────────────────────────────────────────────────
    const streamParams = {
      messages,
      tools:      allTools,
      model:      state.model,
      temperature: config.temperature,
      maxTokens:   config.maxResponseTokens,
      thinking:    state.thinking,
    };

    // Connecting spinner — stops on first token
    const genSpinner = createSpinner(state.thinking !== 'off' ? 'thinking' : 'streaming');

    let genIntercepted = false;
    const originalStreamFn = state.provider.stream.bind(state.provider);
    state.provider.stream = async function* (params) {
      for await (const chunk of originalStreamFn(params)) {
        if (!genIntercepted && (chunk.type === 'text' || chunk.type === 'thinking')) {
          genSpinner.stop();
          printAIHeader(state.provider.name, state.model);
          genIntercepted = true;
        }
        yield chunk;
      }
    };

    let fullResponse = '';
    let toolCalls    = null;

    try {
      const result = await streamWithAutoContinue(state.provider, streamParams, state);
      fullResponse = result.response;
      toolCalls    = result.toolCalls;

      // ── Tool execution loop ─────────────────────────────────────────────────
      let loopCount = 0;
      while (toolCalls?.length && loopCount < 6) {
        genSpinner.stop();

        messages.push({
          role:       'assistant',
          content:    fullResponse || null,
          tool_calls: toolCalls,
        });

        genSpinner.stop();
      if (typeof genSpinner !== 'undefined' && genSpinner) { try { genSpinner.stop(); } catch {} }
streamFlush();
stopActiveSpinner();
for (const tc of toolCalls) {
          const toolName = tc.function?.name || '';
          const toolArgs = (() => { try { return JSON.parse(tc.function?.arguments || '{}'); } catch { return {}; } })();
          const detail   = toolArgs.query || toolArgs.command || toolArgs.path || toolArgs.pattern || toolArgs.urls?.[0] || '';

          // ── ask_user interception ─────────────────────────────────────────
          if (toolName === 'ask_user') {
            const question = toolArgs.question || '';
            const options  = toolArgs.options  || [];
            console.log('');
            console.log(C.orange('  ❓  ') + C.white(question));
            if (options.length) {
              options.forEach((o, i) => console.log(C.dim(`     ${i + 1}. ${o}`)));
            }
            process.stdout.write(C.orange('  ❯  '));
            const answer = await rl.question('');
            const toolResult = answer.trim() || '(no answer)';
            console.log(C.dim(`  ↳  "${toolResult}"`));
            messages.push({ role: 'tool', tool_call_id: tc.id, content: toolResult });
            continue;
          }

          // ── Permission check ──────────────────────────────────────────────
          const needsConfirm = requiresPermission(toolName, toolArgs, state);
          if (needsConfirm) {
            const allowed = await askPermission(toolName, toolArgs, rl);
            if (!allowed) {
              const denied = `Tool call denied by user: ${toolName}(${detail})`;
              console.log(C.warn(`  ✗  Denied`));
              messages.push({ role: 'tool', tool_call_id: tc.id, content: denied });
              continue;
            }
          }

          printToolBadge(toolName, detail);

          const toolSpinner = createSpinner(
            toolName.startsWith('web_')    ? `tool_${toolName}` :
            toolName === 'read_file'       ? 'tool_read' :
            toolName === 'write_file'      ? 'tool_write' :
            toolName === 'edit_file'       ? 'tool_write' :
            toolName === 'create_file'     ? 'tool_write' :
            toolName === 'glob'            ? 'tool_read' :
            toolName === 'execute_command' ? 'tool_shell' :
            toolName === 'search_codebase' ? 'tool_grep' :
            toolName === 'todo_write'      ? 'tool_generic' : 'tool_generic'
          );

          let toolResult;
          try {
            toolResult = await executeTool(tc, { cwd: process.cwd(), rl });
          } catch (e) {
            toolResult = `Error: ${e.message}`;
          }
          toolSpinner.stop();

          console.log(C.dim(`  \u21b3  ${String(toolResult).slice(0, 120).replace(/\n/g, ' ')}\u2026`));
          messages.push({ role: 'tool', tool_call_id: tc.id, content: String(toolResult).slice(0, 8000) });
        }

        fullResponse = '';
        toolCalls    = null;
        genIntercepted = false;

        const loopSpinner = createSpinner('streaming');
        state.provider.stream = async function* (params) {
          for await (const chunk of originalStreamFn(params)) {
            if (!genIntercepted && chunk.type === 'text') {
              loopSpinner.stop();
              printAIHeader(state.provider.name, state.model);
              genIntercepted = true;
            }
            yield chunk;
          }
        };

        const loopResult = await streamWithAutoContinue(state.provider, { ...streamParams, messages }, state);
        fullResponse = loopResult.response;
        toolCalls    = loopResult.toolCalls;
        loopCount++;
      }

      state.lastPartial = '';

    } catch (e) {
      genSpinner.stop();
      printErrorBox(e.message);
      state.lastPartial = fullResponse;
    } finally {
      // Restore original stream function
      state.provider.stream = originalStreamFn;
    }

    // Close AI box
    if (genIntercepted) streamFlush();
printAIFooter();

    // Show roadmap if just generated
    if (state.roadmap && parseRoadmap(fullResponse)) {
      printRoadmapStatus(state.roadmap);
    }

    // Persist history
    if (fullResponse || toolCalls) {
      state.history.push({ role: 'user',      content: userInput });
      state.history.push({ role: 'assistant', content: fullResponse || '(tool actions)' });
      await session.save(state.history);
    }
  }

  await session.save(state.history);
  console.log(C.dim('\n  ✓  Session saved. Bye.\n'));
  rl.close();
}

// ─── Non-interactive mode ─────────────────────────────────────────────────────

export async function runTask(task, forcedSkill) {
  const config   = getConfig();
  const provider = await createProvider(config.provider, { apiKey: config.apiKey });
  const model    = config.model === 'auto' ? provider.defaultModel : config.model;

  let activeSkills = [];
  if (forcedSkill) {
    const { skillRegistry } = await import('../skills/index.js');
    if (skillRegistry[forcedSkill]) activeSkills = [skillRegistry[forcedSkill]];
  } else {
    activeSkills = detectSkills(task);
  }

  const context     = new ContextManager();
  const files       = await context.getRelevantFiles(task);
  const ctxContent  = await context.readFiles(files);
  const systemPrompt = buildSystemPrompt(activeSkills)
    + provider.getSystemPromptAppendix()
    + ROADMAP_PROTOCOL;

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user',   content: ctxContent ? `${task}\n\n<project-context>\n${ctxContent}\n</project-context>` : task },
  ];

  console.log(C.dim(`  Provider: ${provider.name.toUpperCase()}  ·  Model: ${model}\n`));
  printAIHeader(provider.name, model);

  const { response } = await streamWithAutoContinue(provider, {
    messages, tools: allTools, model,
    temperature: config.temperature,
    maxTokens:   config.maxResponseTokens,
  }, null);

  streamFlush();
printAIFooter();
  console.log('');
  process.exit(0);
}
