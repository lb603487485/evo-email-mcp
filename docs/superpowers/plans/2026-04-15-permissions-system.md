# Permissions System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `sendMode` with a per-category permission system (emailWrite, contactWrite, labelWrite × auto/confirm/blocked), enforced server-side via middleware.

**Architecture:** A permission middleware in `handleTool` checks `TOOL_CATEGORIES` mapping and `config.permissions` before every tool call. `emailWrite` uses the existing draft+send flow for confirmation. `contactWrite` and `labelWrite` use a generic double-call pattern with `pendingConfirmations` Map. Config auto-migrates from old `sendMode`.

**Tech Stack:** TypeScript, Vitest

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/providers/interface.ts` | Modify | Update `AppConfig` type — replace `sendMode` with `permissions` |
| `src/config.ts` | Modify | Update default config, add migration logic |
| `src/config.test.ts` | Modify | Update tests for new config shape + migration |
| `src/tools.ts` | Modify | Add middleware, category mapping, preview generator, update email_set_config |
| `src/server.ts` | Modify | Update server instructions |
| `README.md` | Modify | Replace sendMode docs with permissions docs |

---

## Task 1: Update AppConfig Type

**Files:**
- Modify: `src/providers/interface.ts:67-71`

- [ ] **Step 1: Replace sendMode with permissions in AppConfig**

In `src/providers/interface.ts`, replace the `AppConfig` interface:

```typescript
export type PermissionLevel = 'auto' | 'confirm' | 'blocked';

export interface Permissions {
  emailWrite: PermissionLevel;
  contactWrite: PermissionLevel;
  labelWrite: PermissionLevel;
}

export interface AppConfig {
  permissions: Permissions;
  defaultMaxResults: number;
  accounts: Record<string, AccountConfig>;
}
```

- [ ] **Step 2: Build — expect errors**

Run: `npm run build`
Expected: Errors in config.ts, config.test.ts, tools.ts referencing `sendMode`. This confirms the type change propagated.

- [ ] **Step 3: Commit**

```bash
git add src/providers/interface.ts
git commit -m "refactor: replace sendMode with permissions in AppConfig type"
```

---

## Task 2: Update Config Module + Migration

**Files:**
- Modify: `src/config.ts`
- Modify: `src/config.test.ts`

- [ ] **Step 1: Write failing tests for migration and new defaults**

Add these tests to `src/config.test.ts`. Replace the existing `loadConfig` describe block and update the config objects in other tests:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getAccount, listAccounts } from './config';

describe('loadConfig', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns default config with permissions when file does not exist', async () => {
    vi.doMock('./paths', () => ({
      getConfigPath: () => '/tmp/evo-email-mcp-nonexistent-test.json',
      ensureConfigHome: vi.fn(),
    }));
    vi.doMock('fs', async () => {
      const actual = await vi.importActual<typeof import('fs')>('fs');
      return { ...actual, existsSync: () => false, writeFileSync: vi.fn() };
    });
    const { loadConfig } = await import('./config');
    const config = loadConfig();
    expect(config.permissions).toEqual({
      emailWrite: 'confirm',
      contactWrite: 'auto',
      labelWrite: 'auto',
    });
    expect(config.accounts).toEqual({});
    expect((config as any).sendMode).toBeUndefined();
  });

  it('migrates old sendMode to permissions', async () => {
    const oldConfig = JSON.stringify({
      sendMode: 'auto',
      defaultMaxResults: 20,
      accounts: {},
    });
    let savedConfig: string | undefined;
    vi.doMock('./paths', () => ({
      getConfigPath: () => '/tmp/evo-email-mcp-migrate-test.json',
      ensureConfigHome: vi.fn(),
    }));
    vi.doMock('fs', async () => {
      const actual = await vi.importActual<typeof import('fs')>('fs');
      return {
        ...actual,
        existsSync: () => true,
        readFileSync: () => oldConfig,
        writeFileSync: (_path: string, data: string) => { savedConfig = data; },
      };
    });
    const { loadConfig } = await import('./config');
    const config = loadConfig();
    expect(config.permissions.emailWrite).toBe('auto');
    expect(config.permissions.contactWrite).toBe('auto');
    expect(config.permissions.labelWrite).toBe('auto');
    expect((config as any).sendMode).toBeUndefined();
    expect(savedConfig).toBeDefined();
    const saved = JSON.parse(savedConfig!);
    expect(saved.sendMode).toBeUndefined();
    expect(saved.permissions).toBeDefined();
  });
});

describe('getAccount', () => {
  const config = {
    permissions: { emailWrite: 'confirm' as const, contactWrite: 'auto' as const, labelWrite: 'auto' as const },
    defaultMaxResults: 20,
    accounts: { work: { email: 'work@gmail.com', provider: 'gmail' as const } },
  };

  it('resolves by nickname', () => {
    expect(getAccount(config, 'work').email).toBe('work@gmail.com');
  });

  it('resolves by email address', () => {
    expect(getAccount(config, 'work@gmail.com').email).toBe('work@gmail.com');
  });

  it('throws when not found', () => {
    expect(() => getAccount(config, 'unknown')).toThrow('Account not found: unknown');
  });
});

describe('listAccounts', () => {
  it('returns accounts with nickname attached', () => {
    const config = {
      permissions: { emailWrite: 'confirm' as const, contactWrite: 'auto' as const, labelWrite: 'auto' as const },
      defaultMaxResults: 20,
      accounts: { work: { email: 'work@gmail.com', provider: 'gmail' as const } },
    };
    const accounts = listAccounts(config);
    expect(accounts[0].nickname).toBe('work');
    expect(accounts[0].email).toBe('work@gmail.com');
  });
});
```

- [ ] **Step 2: Run — verify tests fail**

Run: `npm test -- src/config.test.ts`
Expected: Failures because `config.ts` still uses `sendMode`.

- [ ] **Step 3: Update config.ts with new defaults and migration**

Replace the entire `src/config.ts`:

```typescript
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { AppConfig, AccountConfig, Permissions, PermissionLevel } from './providers/interface';
import { getConfigPath, ensureConfigHome } from './paths';

const DEFAULT_PERMISSIONS: Permissions = {
  emailWrite: 'confirm',
  contactWrite: 'auto',
  labelWrite: 'auto',
};

const DEFAULT_CONFIG: AppConfig = {
  permissions: { ...DEFAULT_PERMISSIONS },
  defaultMaxResults: 20,
  accounts: {},
};

export function loadConfig(): AppConfig {
  const configPath = getConfigPath();
  if (!existsSync(configPath)) {
    ensureConfigHome();
    writeFileSync(configPath, JSON.stringify(DEFAULT_CONFIG, null, 2), 'utf-8');
    return { ...DEFAULT_CONFIG, permissions: { ...DEFAULT_PERMISSIONS } };
  }
  const raw = JSON.parse(readFileSync(configPath, 'utf-8'));

  // Migrate old sendMode to permissions
  if (raw.sendMode && !raw.permissions) {
    const emailWrite = raw.sendMode as PermissionLevel;
    raw.permissions = {
      emailWrite,
      contactWrite: 'auto',
      labelWrite: 'auto',
    };
    delete raw.sendMode;
    ensureConfigHome();
    writeFileSync(configPath, JSON.stringify(raw, null, 2), 'utf-8');
  }

  // Ensure permissions object exists with defaults
  if (!raw.permissions) {
    raw.permissions = { ...DEFAULT_PERMISSIONS };
  }

  return raw as AppConfig;
}

export function saveConfig(config: AppConfig): void {
  ensureConfigHome();
  writeFileSync(getConfigPath(), JSON.stringify(config, null, 2), 'utf-8');
}

export function getAccount(config: AppConfig, identifier: string): AccountConfig {
  if (config.accounts[identifier]) return config.accounts[identifier];
  const byEmail = Object.values(config.accounts).find(a => a.email === identifier);
  if (byEmail) return byEmail;
  throw new Error(`Account not found: ${identifier}`);
}

export function listAccounts(config: AppConfig): Array<AccountConfig & { nickname: string }> {
  return Object.entries(config.accounts).map(([nickname, account]) => ({
    ...account,
    nickname,
  }));
}
```

- [ ] **Step 4: Run tests — verify they pass**

Run: `npm test -- src/config.test.ts`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/config.ts src/config.test.ts
git commit -m "feat: update config to use permissions, add sendMode migration"
```

---

## Task 3: Add Permission Middleware to tools.ts

**Files:**
- Modify: `src/tools.ts`

- [ ] **Step 1: Add TOOL_CATEGORIES mapping and pendingConfirmations**

At the top of `src/tools.ts`, after the imports, add:

```typescript
type PermissionCategory = 'emailWrite' | 'contactWrite' | 'labelWrite';

const TOOL_CATEGORIES: Record<string, PermissionCategory> = {
  'email_draft': 'emailWrite',
  'email_send': 'emailWrite',
  'email_create_contact': 'contactWrite',
  'email_update_contact': 'contactWrite',
  'email_apply_label': 'labelWrite',
};

// Tracks pending confirmations for confirm-mode write tools (not emailWrite)
const pendingConfirmations = new Map<string, number>(); // key → timestamp

const CONFIRMATION_TTL_MS = 10 * 60 * 1000; // 10 minutes

function confirmationKey(name: string, args: Record<string, unknown>): string {
  return JSON.stringify({ name, args });
}

function cleanStaleConfirmations(): void {
  const now = Date.now();
  for (const [key, timestamp] of pendingConfirmations) {
    if (now - timestamp > CONFIRMATION_TTL_MS) pendingConfirmations.delete(key);
  }
}
```

- [ ] **Step 2: Add generatePreview function**

Add after the confirmation helpers:

```typescript
function generatePreview(name: string, args: Record<string, unknown>, config: ReturnType<typeof loadConfig>): string {
  switch (name) {
    case 'email_create_contact': {
      const { account, name: contactName, email, phone, company, title } = args as {
        account: string; name: string; email: string;
        phone?: string; company?: string; title?: string;
      };
      const acc = getAccount(config, account);
      const fields = [
        `Action:  Create`,
        `Account: ${acc.nickname ?? acc.email} (${acc.email})`,
        `Name:    ${contactName}`,
        `Email:   ${email}`,
        ...(phone ? [`Phone:   ${phone}`] : []),
        ...(company ? [`Company: ${company}`] : []),
        ...(title ? [`Title:   ${title}`] : []),
      ];
      return [
        '========================================',
        '      CONTACT PREVIEW',
        '========================================',
        '',
        ...fields,
        '',
        '========================================',
        '',
        'Call email_create_contact again with the same parameters to confirm.',
      ].join('\n');
    }

    case 'email_update_contact': {
      const { account, query, name: newName, phone, company, title } = args as {
        account: string; query: string;
        name?: string; phone?: string; company?: string; title?: string;
      };
      const acc = getAccount(config, account);
      const changes: string[] = [];
      if (newName) changes.push(`name → ${newName}`);
      if (phone) changes.push(`phone → ${phone}`);
      if (company) changes.push(`company → ${company}`);
      if (title) changes.push(`title → ${title}`);
      return [
        '========================================',
        '      CONTACT UPDATE PREVIEW',
        '========================================',
        '',
        `Action:  Update`,
        `Account: ${acc.nickname ?? acc.email} (${acc.email})`,
        `Query:   ${query}`,
        `Changes: ${changes.join(', ')}`,
        '',
        '========================================',
        '',
        'Call email_update_contact again with the same parameters to confirm.',
      ].join('\n');
    }

    case 'email_apply_label': {
      const { id, account, label, action } = args as {
        id: string; account: string; label: string; action: string;
      };
      const acc = getAccount(config, account);
      return `Will ${action} label "${label}" ${action === 'add' ? 'to' : 'from'} email ${id} in ${acc.nickname ?? acc.email} account.\nCall email_apply_label again with the same parameters to confirm.`;
    }

    default:
      return `Confirm this action by calling ${name} again with the same parameters.`;
  }
}
```

- [ ] **Step 3: Add permission middleware to handleTool**

Replace the beginning of the `handleTool` function (from `export async function handleTool` through `switch (name) {`) with:

```typescript
export async function handleTool(
  name: string,
  args: Record<string, unknown>
): Promise<string> {
  const config = loadConfig();

  // Permission middleware
  const category = TOOL_CATEGORIES[name];
  if (category) {
    const level = config.permissions[category];
    if (level === 'blocked') {
      return `This action is disabled (${category}: blocked). Use email_set_config to change.`;
    }
    // emailWrite uses draft+send flow for confirmation, not the generic pattern
    if (category !== 'emailWrite' && level === 'confirm') {
      cleanStaleConfirmations();
      const key = confirmationKey(name, args);
      if (pendingConfirmations.has(key)) {
        pendingConfirmations.delete(key);
        // Fall through to execute
      } else {
        pendingConfirmations.set(key, Date.now());
        return generatePreview(name, args, config);
      }
    }
  }

  switch (name) {
```

- [ ] **Step 4: Update email_draft handler — use permissions instead of sendMode**

Replace the `email_send` handler. Find the current `case 'email_send':` block and replace it with:

```typescript
    case 'email_send': {
      const draft = args as unknown as Draft;
      const key = draftKey(draft.from, draft.to, draft.subject);
      const savedDraft = approvedDrafts.get(key);

      // In confirm mode, require email_draft to have been called first
      if (config.permissions.emailWrite === 'confirm' && !savedDraft) {
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
```

- [ ] **Step 5: Update email_set_config handler**

Replace the `email_set_config` case:

```typescript
    case 'email_set_config': {
      const { key, value } = args as { key: string; value: string };
      const validPermissions = ['emailWrite', 'contactWrite', 'labelWrite'];
      const validLevels = ['auto', 'confirm', 'blocked'];

      // Support old sendMode key for backwards compatibility
      const permKey = key === 'sendMode' ? 'emailWrite' : key;

      if (validPermissions.includes(permKey)) {
        if (!validLevels.includes(value)) {
          return `Invalid value "${value}". Must be one of: ${validLevels.join(', ')}`;
        }
        config.permissions[permKey as keyof typeof config.permissions] = value as any;
        saveConfig(config);
        return `Permission updated: ${permKey} = ${value}`;
      }

      if (key === 'defaultMaxResults') {
        config.defaultMaxResults = parseInt(value, 10);
        saveConfig(config);
        return `Config updated: ${key} = ${value}`;
      }

      return `Unknown config key: ${key}. Valid keys: ${validPermissions.join(', ')}, defaultMaxResults`;
    }
```

- [ ] **Step 6: Build**

Run: `npm run build`
Expected: Clean compilation.

- [ ] **Step 7: Run all tests**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/tools.ts
git commit -m "feat: add permission middleware with category mapping and confirm flow"
```

---

## Task 4: Update Server Instructions

**Files:**
- Modify: `src/server.ts`

- [ ] **Step 1: Update server instructions**

Replace the instructions string in `src/server.ts`:

```typescript
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
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: Clean compilation.

- [ ] **Step 3: Commit**

```bash
git add src/server.ts
git commit -m "feat: update server instructions with permission levels"
```

---

## Task 5: Update Tool Descriptions

**Files:**
- Modify: `src/tools.ts` (TOOL_DEFINITIONS array)

- [ ] **Step 1: Update email_set_config description**

Change the `email_set_config` tool description:

```typescript
  {
    name: 'email_set_config',
    description: 'Change a runtime permission or setting. Permission keys: emailWrite, contactWrite, labelWrite. Values: auto | confirm | blocked. Also accepts: defaultMaxResults (number). Old key "sendMode" is accepted and maps to emailWrite.',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Permission key (emailWrite, contactWrite, labelWrite) or defaultMaxResults' },
        value: { type: 'string', description: 'Permission level (auto, confirm, blocked) or a number for defaultMaxResults' },
      },
      required: ['key', 'value'],
    },
  },
```

- [ ] **Step 2: Build and test**

Run: `npm run build && npm test`
Expected: Clean build, all tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/tools.ts
git commit -m "feat: update email_set_config description for permissions"
```

---

## Task 6: Update README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Replace sendMode config docs with permissions**

Replace the Configuration section (lines 100-109) in `README.md`:

```markdown
## Configuration

Config is auto-created at `~/.evo-email-mcp/config.json` on first run. Accounts are added automatically by `evo-email-add-account`. The other settings:

### Permissions

Each write category has a permission level: `"auto"` (execute immediately), `"confirm"` (requires confirmation), or `"blocked"` (disabled).

| Category | Controls | Default |
|----------|----------|---------|
| `emailWrite` | `email_draft`, `email_send` | `"confirm"` |
| `contactWrite` | `email_create_contact`, `email_update_contact` | `"auto"` |
| `labelWrite` | `email_apply_label` | `"auto"` |

In confirm mode:
- **emailWrite**: `email_draft` saves to your Drafts folder and shows a preview. Approve, then `email_send` sends it.
- **contactWrite / labelWrite**: The tool returns a preview. Call it again with the same parameters to confirm.

Example config:
```json
{
  "permissions": {
    "emailWrite": "confirm",
    "contactWrite": "auto",
    "labelWrite": "auto"
  },
  "defaultMaxResults": 20
}
```

Old `sendMode` configs are migrated automatically on first load.

Config is hot-reloaded on every request -- no server restart needed.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: update README with permissions system docs"
```

---

## Task 7: Full Build + Test Verification

- [ ] **Step 1: Run all tests**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: Clean compilation.

- [ ] **Step 3: Verify tool count**

Run: `grep -c "name: 'email_" src/tools.ts`
Expected: `12` (unchanged).

---

## Task 8: Smoke Test

- [ ] **Step 1: Rebuild**

```bash
npm run build
```

Restart Claude Code to pick up changes.

- [ ] **Step 2: Test confirm mode for contactWrite**

Set contactWrite to confirm:
```
email_set_config(key: "contactWrite", value: "confirm")
```

Then ask: "Create a contact named Smoke Test with email smoke@example.com in my work account"

Expected: First call returns preview. Second call (same params) executes.

- [ ] **Step 3: Test blocked mode**

```
email_set_config(key: "labelWrite", value: "blocked")
```

Then try to apply a label. Expected: "This action is disabled (labelWrite: blocked)."

- [ ] **Step 4: Test auto mode**

```
email_set_config(key: "contactWrite", value: "auto")
```

Create a contact. Expected: Executes immediately, no preview.

- [ ] **Step 5: Test migration**

Manually edit `~/.evo-email-mcp/config.json` to use old format:
```json
{ "sendMode": "confirm", "defaultMaxResults": 20, "accounts": {...} }
```

Restart server, verify config was migrated to `permissions` format.

- [ ] **Step 6: Final commit**

```bash
git commit -m "feat: permissions system complete — per-category auto/confirm/blocked"
```
