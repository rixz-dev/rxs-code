import { fileTools,      handleFileTool }     from './file-ops.js';
import { shellTools,     handleShellTool }    from './shell.js';
import { searchTools,    handleSearchTool }   from './search.js';
import { webFetchTools,  handleWebFetchTool } from './web-fetch.js';

export const allTools = [
  ...fileTools,
  ...shellTools,
  ...searchTools,
  ...webFetchTools,
];

export async function executeTool(toolCall, context) {
  const { name, arguments: argsStr } = toolCall.function;
  let args;
  try {
    args = JSON.parse(argsStr);
  } catch (e) {
    return `Error: Invalid JSON arguments: ${argsStr}`;
  }

  try {
    switch (name) {
      case 'read_file':       return await handleFileTool('read_file', args, context);
      case 'write_file':      return await handleFileTool('write_file', args, context);
      case 'list_directory':  return await handleFileTool('list_directory', args, context);
      case 'execute_command': return await handleShellTool(args, context);
      case 'search_codebase': return await handleSearchTool(args);
      case 'web_search':      return await handleWebFetchTool('web_search', args);
      case 'web_fetch':       return await handleWebFetchTool('web_fetch', args);
      default:                return `Unknown tool: ${name}`;
    }
  } catch (err) {
    return `Tool execution error: ${err.message}`;
  }
}
