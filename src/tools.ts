import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { loadConfig, saveConfig, getAccount, listAccounts } from './config';
import { getProvider } from './factory';
import { Draft } from './providers/interface';
import { lookupContact, createContact, updateContact } from './providers/contacts';

export const TOOL_DEFINITIONS: Tool[] = [
  {
    name: 'email_search',
    description: 'Search emails across all accounts or a specific account. Defaults to primary inbox only. Set category to "all" to search promotions, social, updates too. IMPORTANT: If multiple accounts are registered and the user did NOT specify which account, ask the user which account to search before proceeding. Use email_list_accounts to show available accounts. Only search all accounts if the user explicitly asks to.',
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
    name: 'email_get',
    description: 'Fetch full content of an email by ID. If the user did NOT specify which account, ask before proceeding.',
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
    name: 'email_draft',
    description: 'Preview a draft before sending. REQUIRED before email_send in confirm mode. Workflow: (1) If user says a name instead of email, call email_lookup_contact first. (2) If user says "my work/personal/school account", match to account nickname via email_list_accounts. If only one account exists, use it automatically. (3) IMPORTANT: If multiple accounts exist and the user did NOT specify which to send from, you MUST ask the user to choose an account before drafting. Do NOT guess or pick a default — sending from the wrong account is a serious mistake. (4) Call email_draft with resolved from and to. (5) Show the FULL preview (From, To, Subject, Body) to the user. (6) Wait for explicit approval before calling email_send. Body supports markdown: **bold**, *italic*, # headings, - bullet points.',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Sender email address. Must be a registered account. Use email_list_accounts to find available accounts.' },
        to: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
        cc: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }], description: 'CC recipients (optional)' },
        bcc: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }], description: 'BCC recipients (optional)' },
        subject: { type: 'string' },
        body: { type: 'string', description: 'Email body. Must use standard email format: greeting (e.g. "Hi [Name],"), body paragraphs, and sign-off (e.g. "Best, [Sender]") — unless the user explicitly requests a different style. Default to plain text. If the user requests formatting (bold, larger text, colors, etc.), use HTML tags directly in the body. Avoid markdown syntax, special dashes (—), or non-ASCII characters that may render as garbled text — use plain equivalents instead.' },
      },
      required: ['from', 'to', 'subject', 'body'],
    },
  },
  {
    name: 'email_send',
    description: 'Send an email. In confirm mode, email_draft MUST be called first and user MUST explicitly approve. Do NOT call this without showing the full draft preview and receiving user confirmation.',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'string' },
        to: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
        cc: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }], description: 'CC recipients (optional)' },
        bcc: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }], description: 'BCC recipients (optional)' },
        subject: { type: 'string' },
        body: { type: 'string' },
      },
      required: ['from', 'to', 'subject', 'body'],
    },
  },
  {
    name: 'email_list_labels',
    description: 'List all labels for an account',
    inputSchema: {
      type: 'object',
      properties: { account: { type: 'string' } },
      required: ['account'],
    },
  },
  {
    name: 'email_apply_label',
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
    name: 'email_download_attachment',
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
    name: 'email_list_accounts',
    description: 'List all registered email accounts. Output format: nickname <email> (provider). When presenting accounts to the user, preserve this format.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'email_lookup_contact',
    description: 'Search contacts by name to find their email address. Checks contacts API first, then falls back to email history. Use this to resolve a person\'s name to an email before drafting. IMPORTANT: If multiple accounts are registered and the user did NOT specify which account, ask the user which account to search before proceeding.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Person name to search for' },
        account: { type: 'string', description: 'Account nickname or email to search contacts from. Omit to search all accounts.' },
      },
      required: ['name'],
    },
  },
  {
    name: 'email_create_contact',
    description: 'Create a new contact in a specific account. IMPORTANT: account is required — ask the user which account if not specified.',
    inputSchema: {
      type: 'object',
      properties: {
        account: { type: 'string', description: 'Account nickname or email (required)' },
        name: { type: 'string', description: 'Contact display name' },
        email: { type: 'string', description: 'Contact email address' },
        phone: { type: 'string', description: 'Phone number (optional)' },
        company: { type: 'string', description: 'Company name (optional)' },
        title: { type: 'string', description: 'Job title (optional)' },
      },
      required: ['account', 'name', 'email'],
    },
  },
  {
    name: 'email_update_contact',
    description: 'Update an existing contact identified by name or email address. Provide only the fields to change. IMPORTANT: account is required — ask the user which account if not specified. NOTE: Deleting contacts is not supported — if the user asks, let them know and suggest they delete it manually at contacts.google.com (Gmail) or outlook.live.com/people (Outlook).',
    inputSchema: {
      type: 'object',
      properties: {
        account: { type: 'string', description: 'Account nickname or email (required)' },
        query: { type: 'string', description: 'Name or email address of the contact to find' },
        name: { type: 'string', description: 'New display name (optional)' },
        phone: { type: 'string', description: 'New phone number (optional)' },
        company: { type: 'string', description: 'New company name (optional)' },
        title: { type: 'string', description: 'New job title (optional)' },
      },
      required: ['account', 'query'],
    },
  },
  {
    name: 'email_set_config',
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

// Tracks drafts that have been previewed (keyed by "from|to|subject")
const approvedDrafts = new Map<string, { draftId: string; account: string }>();

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
    case 'email_search': {
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

    case 'email_get': {
      const { id, account } = args as { id: string; account: string };
      const provider = await getProvider(getAccount(config, account));
      return JSON.stringify(await provider.getEmail(id), null, 2);
    }

    case 'email_draft': {
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

      // Save draft to mailbox
      const provider = await getProvider(fromAccount);
      const draftId = await provider.createDraft(draft);

      const to = Array.isArray(draft.to) ? draft.to.join(', ') : draft.to;
      const cc = draft.cc ? (Array.isArray(draft.cc) ? draft.cc.join(', ') : draft.cc) : '';
      const bcc = draft.bcc ? (Array.isArray(draft.bcc) ? draft.bcc.join(', ') : draft.bcc) : '';

      // Register this draft with its ID for send-by-draft
      approvedDrafts.set(draftKey(draft.from, draft.to, draft.subject), { draftId, account: draft.from });

      return [
        '========================================',
        '         EMAIL DRAFT PREVIEW',
        '========================================',
        '',
        `From:    ${draft.from} (${fromAccount.nickname})`,
        `To:      ${to}`,
        ...(cc ? [`Cc:      ${cc}`] : []),
        ...(bcc ? [`Bcc:     ${bcc}`] : []),
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

    case 'email_send': {
      if (config.sendMode === 'blocked') {
        return 'Sending is disabled (sendMode: blocked). Use email_set_config to change.';
      }
      const draft = args as unknown as Draft;
      const key = draftKey(draft.from, draft.to, draft.subject);
      const savedDraft = approvedDrafts.get(key);

      // In confirm mode, require email_draft to have been called first
      if (config.sendMode === 'confirm' && !savedDraft) {
        return 'Cannot send: email_draft must be called first in confirm mode. Call email_draft to preview, then email_send after user approval.';
      }

      const fromAccount = Object.values(config.accounts).find(a => a.email === draft.from);
      if (!fromAccount) throw new Error(`No registered account for: ${draft.from}`);
      const provider = await getProvider(fromAccount);

      if (savedDraft) {
        // Send the existing draft by ID (no orphan drafts)
        await provider.sendDraft(savedDraft.draftId);
        approvedDrafts.delete(key);
      } else {
        // Auto mode without prior draft — send directly
        await provider.send(draft);
      }

      const to = Array.isArray(draft.to) ? draft.to.join(', ') : draft.to;
      return `Sent from ${draft.from} to ${to}`;
    }

    case 'email_list_labels': {
      const { account } = args as { account: string };
      const provider = await getProvider(getAccount(config, account));
      return JSON.stringify(await provider.listLabels(), null, 2);
    }

    case 'email_apply_label': {
      const { id, account, label, action } = args as {
        id: string; account: string; label: string; action: 'add' | 'remove';
      };
      const provider = await getProvider(getAccount(config, account));
      await provider.applyLabel(id, label, action);
      return `Label "${label}" ${action === 'add' ? 'added to' : 'removed from'} email ${id}`;
    }

    case 'email_download_attachment': {
      const { id, attachment_id, account, save_path } = args as {
        id: string; attachment_id: string; account: string; save_path: string;
      };
      const provider = await getProvider(getAccount(config, account));
      await provider.downloadAttachment(id, attachment_id, save_path);
      return `Attachment saved to ${save_path}`;
    }

    case 'email_list_accounts': {
      const accounts = listAccounts(config);
      const lines = accounts.map(({ nickname, email, provider }) =>
        `${nickname} <${email}> (${provider})`
      );
      return lines.join('\n');
    }

    case 'email_lookup_contact': {
      const { name: contactName, account } = args as { name: string; account?: string };
      const targets = account
        ? [getAccount(config, account)]
        : Object.values(config.accounts);
      const allResults: Array<{ account: string; name: string; email: string }> = [];
      for (const acc of targets) {
        const contacts = await lookupContact(acc, contactName);
        for (const c of contacts) {
          allResults.push({ account: acc.email, name: c.name, email: c.email });
        }
      }
      if (allResults.length === 0) {
        return `No contacts found matching "${contactName}".`;
      }
      return JSON.stringify(allResults, null, 2);
    }

    case 'email_create_contact': {
      const { account, ...fields } = args as {
        account: string; name: string; email: string;
        phone?: string; company?: string; title?: string;
      };
      const acc = getAccount(config, account);
      await createContact(acc, fields);
      return `Contact "${fields.name}" <${fields.email}> created in ${acc.email}.`;
    }

    case 'email_update_contact': {
      const { account, query, name, phone, company, title } = args as {
        account: string; query: string;
        name?: string; phone?: string; company?: string; title?: string;
      };
      if (!name && !phone && !company && !title) {
        return 'Provide at least one field to update (name, phone, company, or title).';
      }
      const acc = getAccount(config, account);
      await updateContact(acc, { query, name, phone, company, title });
      return `Contact matching "${query}" updated in ${acc.email}.`;
    }

    case 'email_set_config': {
      const { key, value } = args as { key: string; value: string };
      (config as any)[key] = value;
      saveConfig(config);
      return `Config updated: ${key} = ${value}`;
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
