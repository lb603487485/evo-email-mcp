import keytar from 'keytar';

const SERVICE = 'evo-email-mcp';

export async function getToken(
  provider: string,
  email: string
): Promise<Record<string, unknown> | null> {
  const raw = await keytar.getPassword(SERVICE, `${provider}:${email}`);
  return raw ? JSON.parse(raw) : null;
}

export async function setToken(
  provider: string,
  email: string,
  token: Record<string, unknown>
): Promise<void> {
  await keytar.setPassword(SERVICE, `${provider}:${email}`, JSON.stringify(token));
}

export async function deleteToken(provider: string, email: string): Promise<void> {
  await keytar.deletePassword(SERVICE, `${provider}:${email}`);
}
