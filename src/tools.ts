import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { loadConfig, saveConfig, getAccount, listAccounts } from './config';
import { getProvider } from './factory';
import { Draft } from './providers/interface';

export const TOOL_DEFINITIONS: Tool[] = [
  {
    name: 'search_emails',
    description: 'Search emails across all accounts or a specific account',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Gmail query syntax, e.g. "from:alice is:unread"' },
        account: { type: 'string', description: 'Account nickname or email. Omit to search all.' },
        max_results: { type: 'number', description: 'Max results per account (default 20)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_email',
    description: 'Fetch full content of an email by ID',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        account: { type: 'string', description: 'Account nickname or email' },
      },
      required: ['id', 'account'],
    },
  },
  {
    name: 'draft_email',
    description: 'Preview a draft before sending. Always call this before send_email when sendMode is confirm.',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'string' },
        to: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
        subject: { type: 'string' },
        body: { type: 'string' },
      },
      required: ['from', 'to', 'subject', 'body'],
    },
  },
  {
    name: 'send_email',
    description: 'Send an email. In confirm mode, call draft_email first and wait for user approval.',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'string' },
        to: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
        subject: { type: 'string' },
        body: { type: 'string' },
      },
      required: ['from', 'to', 'subject', 'body'],
    },
  },
  {
    name: 'list_labels',
    description: 'List all labels for an account',
    inputSchema: {
      type: 'object',
      properties: { account: { type: 'string' } },
      required: ['account'],
    },
  },
  {
    name: 'apply_label',
    description: 'Add or remove a label on an email',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        account: { type: 'string' },
        label: { type: 'string' },
        action: { type: 'string', enum: ['add', 'remove'] },
      },
      required: ['id', 'account', 'label', 'action'],
    },
  },
  {
    name: 'download_attachment',
    description: 'Save an email attachment to a local file path',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Email ID' },
        attachment_id: { type: 'string' },
        account: { type: 'string' },
        save_path: { type: 'string', description: 'Absolute local path to save the file' },
      },
      required: ['id', 'attachment_id', 'account', 'save_path'],
    },
  },
  {
    name: 'list_accounts',
    description: 'List all registered email accounts',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'set_config',
    description: 'Change a runtime setting. Key: sendMode, Value: auto | confirm | blocked',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string' },
        value: { type: 'string' },
      },
      required: ['key', 'value'],
    },
  },
];

export async function handleTool(
  name: string,
  args: Record<string, unknown>
): Promise<string> {
  const config = loadConfig();

  switch (name) {
    case 'search_emails': {
      const { query, account, max_results } = args as {
        query: string; account?: string; max_results?: number;
      };
      const targets = account
        ? [getAccount(config, account)]
        : Object.values(config.accounts);
      const results = await Promise.all(
        targets.map(acc =>
          getProvider(acc).then(p => p.search({ q: query, maxResults: max_results ?? config.defaultMaxResults }))
        )
      );
      return JSON.stringify(results.flat(), null, 2);
    }

    case 'get_email': {
      const { id, account } = args as { id: string; account: string };
      const provider = await getProvider(getAccount(config, account));
      return JSON.stringify(await provider.getEmail(id), null, 2);
    }

    case 'draft_email': {
      const draft = args as unknown as Draft;
      const to = Array.isArray(draft.to) ? draft.to.join(', ') : draft.to;
      return [
        '--- DRAFT PREVIEW ---',
        `From:    ${draft.from}`,
        `To:      ${to}`,
        `Subject: ${draft.subject}`,
        '',
        draft.body,
        '--- END DRAFT ---',
        '',
        'Reply "send" to send, or describe changes to revise.',
      ].join('\n');
    }

    case 'send_email': {
      if (config.sendMode === 'blocked') {
        return 'Sending is disabled (sendMode: blocked). Use set_config to change.';
      }
      const draft = args as unknown as Draft;
      const fromAccount = Object.values(config.accounts).find(a => a.email === draft.from);
      if (!fromAccount) throw new Error(`No registered account for: ${draft.from}`);
      const provider = await getProvider(fromAccount);
      await provider.send(draft);
      const to = Array.isArray(draft.to) ? draft.to.join(', ') : draft.to;
      return `Sent from ${draft.from} to ${to}`;
    }

    case 'list_labels': {
      const { account } = args as { account: string };
      const provider = await getProvider(getAccount(config, account));
      return JSON.stringify(await provider.listLabels(), null, 2);
    }

    case 'apply_label': {
      const { id, account, label, action } = args as {
        id: string; account: string; label: string; action: 'add' | 'remove';
      };
      const provider = await getProvider(getAccount(config, account));
      await provider.applyLabel(id, label, action);
      return `Label "${label}" ${action === 'add' ? 'added to' : 'removed from'} email ${id}`;
    }

    case 'download_attachment': {
      const { id, attachment_id, account, save_path } = args as {
        id: string; attachment_id: string; account: string; save_path: string;
      };
      const provider = await getProvider(getAccount(config, account));
      await provider.downloadAttachment(id, attachment_id, save_path);
      return `Attachment saved to ${save_path}`;
    }

    case 'list_accounts': {
      return JSON.stringify(
        listAccounts(config).map(({ nickname, email, provider }) => ({ nickname, email, provider })),
        null, 2
      );
    }

    case 'set_config': {
      const { key, value } = args as { key: string; value: string };
      (config as any)[key] = value;
      saveConfig(config);
      return `Config updated: ${key} = ${value}`;
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
