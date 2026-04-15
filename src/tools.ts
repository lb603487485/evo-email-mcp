import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { loadConfig, saveConfig, getAccount, listAccounts } from './config';
import { getProvider } from './factory';
import { Draft } from './providers/interface';

export const TOOL_DEFINITIONS: Tool[] = [
  {
    name: 'search_emails',
    description: 'Search emails across all accounts or a specific account. Defaults to primary inbox only. Set category to "all" to search promotions, social, updates too.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Gmail query syntax, e.g. "from:alice is:unread"' },
        account: { type: 'string', description: 'Account nickname or email. Omit to search all.' },
        max_results: { type: 'number', description: 'Max results per account (default 20)' },
        category: { type: 'string', description: 'Gmail category filter: "primary" (default), "promotions", "social", "updates", "forums", or "all"', enum: ['primary', 'promotions', 'social', 'updates', 'forums', 'all'] },
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

// Tracks drafts that have been previewed (keyed by "from|to|subject" to match send to draft)
const approvedDrafts = new Set<string>();

function draftKey(from: string, to: string | string[], subject: string): string {
  const toStr = Array.isArray(to) ? to.sort().join(',') : to;
  return `${from}|${toStr}|${subject}`;
}

export async function handleTool(
  name: string,
  args: Record<string, unknown>
): Promise<string> {
  const config = loadConfig();

  switch (name) {
    case 'search_emails': {
      const { query, account, max_results, category } = args as {
        query: string; account?: string; max_results?: number; category?: string;
      };
      const cat = category ?? 'primary';
      const fullQuery = cat === 'all' ? query : `category:${cat} ${query}`;
      const targets = account
        ? [getAccount(config, account)]
        : Object.values(config.accounts);
      const results = await Promise.all(
        targets.map(acc =>
          getProvider(acc).then(p => p.search({ q: fullQuery, maxResults: max_results ?? config.defaultMaxResults }))
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
      const accounts = listAccounts(config);

      // Validate "from" is a registered account
      const fromAccount = accounts.find(a => a.email === draft.from);
      if (!fromAccount) {
        const accountList = accounts.map(a => `  - ${a.nickname}: ${a.email}`).join('\n');
        return [
          `No registered account for: ${draft.from}`,
          '',
          'Available accounts:',
          accountList,
          '',
          'Please specify which account to send from.',
        ].join('\n');
      }

      const to = Array.isArray(draft.to) ? draft.to.join(', ') : draft.to;

      // Register this draft as previewed
      approvedDrafts.add(draftKey(draft.from, draft.to, draft.subject));

      return [
        '========================================',
        '         EMAIL DRAFT PREVIEW',
        '========================================',
        '',
        `From:    ${draft.from} (${fromAccount.nickname})`,
        `To:      ${to}`,
        `Subject: ${draft.subject}`,
        '',
        '----------------------------------------',
        '',
        draft.body,
        '',
        '========================================',
        '',
        'IMPORTANT: Show the FULL preview above to the user including From, To, and Subject before sending.',
        'Ask the user: "Ready to send?" and wait for explicit approval.',
      ].join('\n');
    }

    case 'send_email': {
      if (config.sendMode === 'blocked') {
        return 'Sending is disabled (sendMode: blocked). Use set_config to change.';
      }
      const draft = args as unknown as Draft;

      // In confirm mode, require draft_email to have been called first
      if (config.sendMode === 'confirm') {
        const key = draftKey(draft.from, draft.to, draft.subject);
        if (!approvedDrafts.has(key)) {
          return 'Cannot send: draft_email must be called first in confirm mode. Call draft_email to preview, then send_email after user approval.';
        }
        approvedDrafts.delete(key);
      }

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
