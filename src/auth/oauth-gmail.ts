import { google } from 'googleapis';
import http from 'http';
import { URL } from 'url';
import open from 'open';
import { readFileSync } from 'fs';
import { getToken, setToken } from './keychain';
import { getCredentialsPath } from '../paths';

const REDIRECT_URI = 'http://localhost:3001/oauth/callback';
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/contacts',
];

interface GmailCredentialsFile {
  installed: { client_id: string; client_secret: string };
}

function loadCredentials(): { clientId: string; clientSecret: string } {
  const credPath = getCredentialsPath('gmail');
  const file = JSON.parse(readFileSync(credPath, 'utf-8')) as GmailCredentialsFile;
  return { clientId: file.installed.client_id, clientSecret: file.installed.client_secret };
}

export async function runGmailOAuthFlow(): Promise<string> {
  const { clientId, clientSecret } = loadCredentials();
  const client = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);

  const authUrl = client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
  });

  console.log('\nOpening browser for Google authorization...');
  await open(authUrl);

  const code = await new Promise<string>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url!, 'http://localhost:3001');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<h1>Authorization complete. You can close this tab.</h1>');
      server.close();
      const error = url.searchParams.get('error');
      const code = url.searchParams.get('code');
      if (error) reject(new Error(`OAuth error: ${error}`));
      else if (code) resolve(code);
      else reject(new Error('No authorization code received'));
    });
    server.listen(3001);
    server.on('error', reject);
    setTimeout(() => { server.close(); reject(new Error('OAuth flow timed out')); }, 120_000);
  });

  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);

  const oauth2 = google.oauth2({ version: 'v2', auth: client });
  const { data } = await oauth2.userinfo.get();
  const email = data.email!;

  await setToken('gmail', email, tokens as Record<string, unknown>);
  console.log(`\nAuthorized: ${email}`);
  return email;
}

export async function getGmailAuthClient(email: string) {
  const { clientId, clientSecret } = loadCredentials();
  const client = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);

  const tokens = await getToken('gmail', email);
  if (!tokens) {
    throw new Error(`No Gmail credentials for ${email}. Run: npm run add-account`);
  }

  client.setCredentials(tokens);

  client.on('tokens', async (newTokens) => {
    const current = (await getToken('gmail', email)) ?? {};
    await setToken('gmail', email, { ...current, ...newTokens });
  });

  return client;
}
