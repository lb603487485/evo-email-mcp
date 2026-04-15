import path from 'path';
import { mkdirSync } from 'fs';

const CONFIG_HOME = path.join(process.env.HOME ?? '', '.evo-email-mcp');

export function getConfigHome(): string {
  return CONFIG_HOME;
}

export function getConfigPath(): string {
  return path.join(CONFIG_HOME, 'config.json');
}

export function getCredentialsPath(provider: string): string {
  return path.join(CONFIG_HOME, 'credentials', `${provider}.json`);
}

export function ensureConfigHome(): void {
  mkdirSync(path.join(CONFIG_HOME, 'credentials'), { recursive: true });
}
