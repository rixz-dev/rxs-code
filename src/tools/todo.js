// ─── In-memory todo store (per session) ───────────────────────────────────────
// Todos persist in memory for the session + optionally to .rxs-todos.json

import fs from 'fs/promises';
import { resolve } from 'path';

let _todos = [];  // [{ id, status:'pending'|'in_progress'|'done', priority:'high'|'medium'|'low', content }]
let _nextId = 1;

const TODO_FILE = '.rxs-todos.json';

async function loadTodos(cwd) {
  try {
    const raw = await fs.readFile(resolve(cwd, TODO_FILE), 'utf8');
    const data = JSON.parse(raw);
    _todos  = data.todos  || [];
    _nextId = data.nextId || (_todos.length + 1);
  } catch {
    // Fresh session
    _todos  = [];
    _nextId = 1;
  }
}

async function saveTodos(cwd) {
  try {
    await fs.writeFile(
      resolve(cwd, TODO_FILE),
      JSON.stringify({ todos: _todos, nextId: _nextId }, null, 2),
      'utf8'
    );
  } catch { /* non-fatal */ }
}

function formatTodo(t) {
  const icon = t.status === 'done' ? '✓' : t.status === 'in_progress' ? '▶' : '○';
  const pri  = t.priority === 'high' ? '!' : t.priority === 'low' ? '·' : ' ';
  return `[${icon}] ${pri} #${t.id}  ${t.content}`;
}

// ─── Tool Definitions ─────────────────────────────────────────────────────────

export const todoTools = [
  {
    type: 'function',
    function: {
      name: 'todo_write',
      description: [
        'Manage the session task list. Use this to track what needs to be done.',
        'ALWAYS use this at the start of a complex task (create todos for each step),',
        'and update statuses as you complete each step.',
        'Actions: create | update | delete | list',
      ].join('\n'),
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['create', 'update', 'delete', 'list'],
            description: 'What to do',
          },
          todos: {
            type: 'array',
            description: 'For "create": array of {content, priority?}. For "update": array of {id, status?, content?, priority?}. For "delete": array of {id}.',
            items: {
              type: 'object',
              properties: {
                id:       { type: 'number' },
                content:  { type: 'string' },
                status:   { type: 'string', enum: ['pending', 'in_progress', 'done'] },
                priority: { type: 'string', enum: ['high', 'medium', 'low'] },
              },
            },
          },
        },
        required: ['action'],
      },
    },
  },
];

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function handleTodoTool(args, context) {
  const cwd = context.cwd || process.cwd();
  await loadTodos(cwd);

  const { action, todos: items = [] } = args;

  switch (action) {
    case 'create': {
      if (!items.length) throw new Error('todo_write create requires todos array');
      const created = [];
      for (const item of items) {
        if (!item.content) throw new Error('Each todo must have a content field');
        const todo = {
          id:       _nextId++,
          status:   'pending',
          priority: item.priority || 'medium',
          content:  item.content,
        };
        _todos.push(todo);
        created.push(todo);
      }
      await saveTodos(cwd);
      return `Created ${created.length} todo(s):\n${created.map(formatTodo).join('\n')}`;
    }

    case 'update': {
      if (!items.length) throw new Error('todo_write update requires todos array with ids');
      const updated = [];
      for (const item of items) {
        const todo = _todos.find(t => t.id === item.id);
        if (!todo) throw new Error(`Todo #${item.id} not found`);
        if (item.status   !== undefined) todo.status   = item.status;
        if (item.content  !== undefined) todo.content  = item.content;
        if (item.priority !== undefined) todo.priority = item.priority;
        updated.push(todo);
      }
      await saveTodos(cwd);
      return `Updated ${updated.length} todo(s):\n${updated.map(formatTodo).join('\n')}`;
    }

    case 'delete': {
      if (!items.length) throw new Error('todo_write delete requires todos array with ids');
      const ids = items.map(i => i.id);
      const before = _todos.length;
      _todos = _todos.filter(t => !ids.includes(t.id));
      await saveTodos(cwd);
      return `Deleted ${before - _todos.length} todo(s). ${_todos.length} remaining.`;
    }

    case 'list': {
      if (_todos.length === 0) return 'No todos. Use todo_write with action "create" to add tasks.';
      const pending     = _todos.filter(t => t.status === 'pending');
      const in_progress = _todos.filter(t => t.status === 'in_progress');
      const done        = _todos.filter(t => t.status === 'done');
      const lines = [];
      if (in_progress.length) { lines.push('IN PROGRESS:');  lines.push(...in_progress.map(formatTodo)); }
      if (pending.length)     { lines.push('PENDING:');      lines.push(...pending.map(formatTodo)); }
      if (done.length)        { lines.push('DONE:');         lines.push(...done.map(formatTodo)); }
      return lines.join('\n');
    }

    default:
      throw new Error(`Unknown todo action: ${action}. Use: create | update | delete | list`);
  }
}

// Export for use in UI
export function getTodos() { return _todos; }
