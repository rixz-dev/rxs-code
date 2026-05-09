import { createProvider, getAvailableProviders, getApiKeyForProvider } from './provider-factory.js';
import { ContextManager } from './context.js';
import { allTools, executeTool } from '../tools/index.js';
import { detectSkills } from '../skills/index.js';
import { buildSystemPrompt } from '../prompts/system.js';
import { estimateTokens, truncateToBudget } from '../utils/tokenizer.js';
import { promptCache } from '../utils/cache.js';
import { SessionManager } from '../utils/session.js';
import { ModelCatalog } from '../utils/model-catalog.js';
import { getConfig, resetConfig } from '../utils/config.js';
import { isRetryableError } from '../utils/retry.js';
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
  let autoContinues = 0;
  let currentParams  = { ...baseParams, messages: [...baseParams.messages] };
  let accumulated    = '';

  while (true) {
    let partial   = '';
    let toolCalls = null;
    let err       = null;

    try {
      for await (const chunk of provider.stream(currentParams)) {
        if (chunk.type === 'text') {
          streamChunk(chunk.content);
          partial += chunk.content;
        }
        if (chunk.type === 'thinking') {
          // Show subtle thinking indicator
          process.stdout.write(C.dim('·'));
        }
        if (chunk.type === 'thinking_end') {
          process.stdout.write('\n');
          process.stdout.write(C.ai('│') + '  ');
        }
        if (chunk.type === 'tool_calls') {
          toolCalls = chunk.content;
          partial   = chunk.fullContent || partial;
        }
      }
      streamFlush();
      printAIFooterLine();
      accumulated += partial;

      // Parse & store roadmap if found in this chunk
      const roadmap = parseRoadmap(accumulated);
      if (roadmap && stateRef) {
        stateRef.roadmap = roadmap;
      }

      return { response: accumulated, toolCalls };

    } catch (e) {
      err          = e;
      streamFlush();
      printAIFooterLine();
      accumulated += partial;
    }

    // ── Error recovery ────────────────────────────────────────────────────────
    const retryable  = isRetryableError(err);
    const hasContent = accumulated.trim().length > 30;

    if (!retryable || autoContinues >= MAX_AUTO_CONTINUE) {
      process.stdout.write(C.error(`\n\n  ✖  ${err?.message || String(err)}`));
      return { response: accumulated, toolCalls: null };
    }

    autoContinues++;

    if (hasContent) {
      printAutoContinueBadge(autoContinues, MAX_AUTO_CONTINUE);
      const roadmap = stateRef?.roadmap || parseRoadmap(accumulated);
      const continueMsg = buildRoadmapContinuePrompt(roadmap);

      currentParams = {
        ...baseParams,
        messages: [
          ...currentParams.messages,
          { role: 'assistant', content: accumulated },
          { role: 'user',      content: continueMsg },
        ],
      };

      // Reprint AI header for the continuation
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
        '/clear                  Clear conversation history',
        '/save [name]            Save session',
        '/load [name]            Load saved session',
        '/tokens                 Token usage bar',
        '/refresh                Refresh model catalog cache',
        '/continue               Manual continue after interruption',
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
    thinking:      'off',
    history:       [],
    activeSkills:  [],
    roadmap:       null,
    lastPartial:   '',
    _manualContinue: null,
  };

  printBanner(provider.name, model, { ...config, version: pkg.version });

  // ── Load previous session ─────────────────────────────────────────────────
  const session = new SessionManager('default');
  const saved   = await session.load();
  if (saved.length) {
    state.history = saved;
    console.log(C.dim(`  ↺  Session restored  ·  ${saved.length} messages`));
  }

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

    const messages = [
      { role: 'system', content: systemPrompt },
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
          const detail   = toolArgs.query || toolArgs.path || toolArgs.urls?.[0] || '';

          printToolBadge(toolName, detail);

          const toolSpinner = createSpinner(
            toolName.startsWith('web_') ? `tool_${toolName}` :
            toolName === 'read_file'    ? 'tool_read' :
            toolName === 'write_file'   ? 'tool_write' :
            toolName === 'execute_command' ? 'tool_shell' :
            toolName === 'search_codebase' ? 'tool_grep' : 'tool_generic'
          );

          let toolResult;
          try {
            toolResult = await executeTool(tc, { cwd: process.cwd() });
          } catch (e) {
            toolResult = `Error: ${e.message}`;
          }
          toolSpinner.stop();

          console.log(C.dim(`  ↳  ${String(toolResult).slice(0, 120).replace(/\n/g, ' ')}…`));
          messages.push({ role: 'tool', tool_call_id: tc.id, content: String(toolResult).slice(0, 4000) });
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
