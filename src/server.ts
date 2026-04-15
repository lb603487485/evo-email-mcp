#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { TOOL_DEFINITIONS, handleTool } from './tools';

const server = new Server(
  { name: 'evo-email-mcp', version: '1.0.0' },
  {
    capabilities: { tools: {} },
    instructions: `Email MCP server for Gmail and Outlook accounts.

Permissions: Each write category (emailWrite, contactWrite, labelWrite) has a permission level:
- "auto": executes immediately
- "confirm": requires confirmation (call the same tool twice with identical parameters)
- "blocked": action is disabled

For emailWrite in confirm mode, call email_draft first (saves to Drafts folder + shows preview), then email_send after user approval.

IMPORTANT — No destructive operations:
This server does NOT support deleting emails, drafts, or contacts.
If the user asks to delete something, do NOT attempt it. Instead, guide them:
- Emails/Drafts: "You can delete this at mail.google.com (Gmail) or outlook.live.com (Outlook)"
- Contacts: "You can delete this at contacts.google.com (Gmail) or outlook.live.com/people (Outlook)"`,
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOL_DEFINITIONS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    const text = await handleTool(name, (args ?? {}) as Record<string, unknown>);
    return { content: [{ type: 'text', text }] };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
