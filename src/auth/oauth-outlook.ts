import { readFileSync } from 'fs';
import path from 'path';
import http from 'http';
import { URL } from 'url';
import open from 'open';
import { getToken, setToken } from './keychain';

const REDIRECT_URI = 'http://localhost:3001/oauth/callback';
const AUTH_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';
const TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
const SCOPES = 'Mail.ReadWrite Mail.Send User.Read People.Read offline_access';

interface OutlookCredentialsFile {
  client_id: string;
  client_secret: string;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

function loadCredentials(): { clientId: string; clientSecret: string } {
  const credPath = path.join(__dirname, '../../credentials/outlook.json');
  const file = JSON.parse(readFileSync(credPath, 'utf-8')) as OutlookCredentialsFile;
  return { clientId: file.client_id, clientSecret: file.client_secret };
}

async function postToken(params: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
  if (!res.ok) throw new Error(`Token request failed: ${await res.text()}`);
  return res.json() as Promise<TokenResponse>;
}

export async function runOutlookOAuthFlow(): Promise<string> {
  const { clientId, clientSecret } = loadCredentials();

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    response_mode: 'query',
  });

  console.log('\nOpening browser for Microsoft authorization...');
  await open(`${AUTH_URL}?${params.toString()}`);

  const code = await new Promise<string>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url!, 'http://localhost:3001');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<h1>Authorization complete. You can close this tab.</h1>');
      server.close();
      const error = url.searchParams.get('error');
      const c = url.searchParams.get('code');
      if (error) reject(new Error(`OAuth error: ${error}`));
      else if (c) resolve(c);
      else reject(new Error('No authorization code received'));
    });
    server.listen(3001);
    server.on('error', reject);
    setTimeout(() => { server.close(); reject(new Error('OAuth flow timed out')); }, 120_000);
  });

  const tokens = await postToken({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: REDIRECT_URI,
    grant_type: 'authorization_code',
  });

  const profileRes = await fetch('https://graph.microsoft.com/v1.0/me', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  if (!profileRes.ok) throw new Error(`Failed to fetch profile: ${await profileRes.text()}`);
  const profile = await profileRes.json() as { mail?: string; userPrincipalName?: string };
  const email = (profile.mail ?? profile.userPrincipalName)!;

  await setToken('outlook', email, {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: Date.now() + tokens.expires_in * 1000,
  });

  console.log(`\nAuthorized: ${email}`);
  return email;
}

export async function getOutlookAuthClient(email: string): Promise<{ accessToken: string }> {
  const stored = await getToken('outlook', email);
  if (!stored) throw new Error(`No Outlook credentials for ${email}. Run: npm run add-account`);

  const { access_token, refresh_token, expires_at } = stored as {
    access_token: string;
    refresh_token: string;
    expires_at: number;
  };

  if (Date.now() >= expires_at - 60_000) {
    const { clientId, clientSecret } = loadCredentials();
    const tokens = await postToken({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token,
      grant_type: 'refresh_token',
    });
    const updated = {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token ?? refresh_token,
      expires_at: Date.now() + tokens.expires_in * 1000,
    };
    await setToken('outlook', email, updated);
    return { accessToken: tokens.access_token };
  }

  return { accessToken: access_token };
}
