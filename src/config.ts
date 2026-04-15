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
