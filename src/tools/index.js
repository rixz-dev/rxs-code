import { fileTools,       handleFileTool }       from './file-ops.js';
import { fileEditTools,   handleFileEditTool }   from './file-edit.js';
import { shellTools,      handleShellTool }      from './shell.js';
import { searchTools,     handleSearchTool }     from './search.js';
import { webFetchTools,   handleWebFetchTool }   from './web-fetch.js';
import { globTools,       handleGlobTool }       from './glob-tool.js';
import { todoTools,       handleTodoTool }       from './todo.js';
import { askUserTools,    handleAskUserTool }    from './ask-user.js';

export const allTools = [
  // File operations (read, write, list)
  ...fileTools,
  // Surgical editing (edit_file, create_file)
  ...fileEditTools,
  // Pattern-based file discovery
  ...globTools,
  // Shell execution
  ...shellTools,
  // Codebase search (grep)
  ...searchTools,
  // Web
  ...webFetchTools,
  // Task tracking
  ...todoTools,
  // Clarification
  ...askUserTools,
];

export async function executeTool(toolCall, context) {
  const { name, arguments: argsStr } = toolCall.function;
  let args;
  try {
    args = JSON.parse(argsStr);
  } catch (e) {
    return `Error: Invalid JSON arguments for ${name}: ${argsStr}`;
  }

  try {
    switch (name) {
      // File ops
      case 'read_file':       return await handleFileTool('read_file',       args, context);
      case 'write_file':      return await handleFileTool('write_file',      args, context);
      case 'list_directory':  return await handleFileTool('list_directory',  args, context);
      // Surgical edits
      case 'edit_file':       return await handleFileEditTool('edit_file',   args, context);
      case 'create_file':     return await handleFileEditTool('create_file', args, context);
      // Glob
      case 'glob':            return await handleGlobTool(args, context);
      // Shell
      case 'execute_command': return await handleShellTool(args, context);
      // Search
      case 'search_codebase': return await handleSearchTool(args);
      // Web
      case 'web_search':      return await handleWebFetchTool('web_search', args);
      case 'web_fetch':       return await handleWebFetchTool('web_fetch',  args);
      // Todos
      case 'todo_write':      return await handleTodoTool(args, context);
      // Ask user (CLI intercepts this before it reaches here)
      case 'ask_user':        return await handleAskUserTool(args);

      default:
        return `Unknown tool: ${name}. Available: ${allTools.map(t => t.function.name).join(', ')}`;
    }
  } catch (err) {
    return `Tool error [${name}]: ${err.message}`;
  }
}
