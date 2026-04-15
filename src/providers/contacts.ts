import { google } from 'googleapis';
import { getGmailAuthClient } from '../auth/oauth-gmail';
import { getOutlookAuthClient } from '../auth/oauth-outlook';
import { AccountConfig } from './interface';

export interface Contact {
  name: string;
  email: string;
  source: 'contacts' | 'email_history';
}

type GraphEmailAddress = { emailAddress: { name?: string; address: string } };

export async function lookupContact(acc: AccountConfig, query: string): Promise<Contact[]> {
  if (acc.provider === 'outlook') return outlookLookupContact(acc.email, query);
  return gmailLookupContact(acc.email, query);
}

async function gmailLookupContact(email: string, query: string): Promise<Contact[]> {
  const auth = await getGmailAuthClient(email);

  const people = google.people({ version: 'v1', auth });
  const res = await people.people.searchContacts({
    query,
    readMask: 'names,emailAddresses',
    pageSize: 10,
  });

  const results: Contact[] = [];
  for (const result of res.data.results ?? []) {
    const person = result.person;
    if (!person) continue;
    const name = person.names?.[0]?.displayName ?? '';
    for (const e of person.emailAddresses ?? []) {
      if (e.value) results.push({ name, email: e.value, source: 'contacts' });
    }
  }

  if (results.length > 0) return results;

  const gmail = google.gmail({ version: 'v1', auth });
  const searchRes = await gmail.users.messages.list({ userId: 'me', q: query, maxResults: 10 });

  const seen = new Set<string>();
  for (const msg of searchRes.data.messages ?? []) {
    const full = await gmail.users.messages.get({
      userId: 'me', id: msg.id!, format: 'metadata', metadataHeaders: ['From', 'To'],
    });
    const headers: Array<{ name: string; value: string }> = (full.data.payload?.headers ?? []) as any;
    for (const h of headers) {
      if (h.name !== 'From' && h.name !== 'To') continue;
      for (const addr of h.value.split(',')) {
        const match = addr.match(/(?:"?([^"<]*)"?\s*)?<?([^>]+@[^>]+)>?/);
        if (!match) continue;
        const name = (match[1] || '').trim();
        const emailAddr = match[2].trim().toLowerCase();
        if (emailAddr === email.toLowerCase()) continue;
        if (/^(no-?reply|noreply|notifications?|mailer-daemon|postmaster)@/i.test(emailAddr)) continue;
        if (/@(linkedin\.com|zoom\.us|glassdoor\.com|github\.com|google\.com|googlemail\.com)$/i.test(emailAddr) && !emailAddr.includes(query.toLowerCase())) continue;
        if ((name.toLowerCase().includes(query.toLowerCase()) || emailAddr.includes(query.toLowerCase())) && !seen.has(emailAddr)) {
          seen.add(emailAddr);
          results.push({ name: name || emailAddr, email: emailAddr, source: 'email_history' });
        }
      }
    }
  }

  return results;
}

async function outlookLookupContact(email: string, query: string): Promise<Contact[]> {
  const { accessToken } = await getOutlookAuthClient(email);
  const headers = { Authorization: `Bearer ${accessToken}` };

  const peopleRes = await fetch(
    `https://graph.microsoft.com/v1.0/me/people?$search="${encodeURIComponent(query)}"&$top=10`,
    { headers }
  );
  if (!peopleRes.ok) throw new Error(`People API error: ${await peopleRes.text()}`);
  const peopleData = await peopleRes.json() as {
    value: Array<{ displayName: string; scoredEmailAddresses: Array<{ address: string }> }>;
  };

  const results: Contact[] = [];
  for (const person of peopleData.value ?? []) {
    for (const e of person.scoredEmailAddresses ?? []) {
      if (e.address) results.push({ name: person.displayName, email: e.address, source: 'contacts' });
    }
  }

  if (results.length > 0) return results;

  const msgRes = await fetch(
    `https://graph.microsoft.com/v1.0/me/messages?$search="${encodeURIComponent(query)}"&$top=10&$select=from,toRecipients`,
    { headers }
  );
  if (!msgRes.ok) throw new Error(`Messages API error: ${await msgRes.text()}`);
  const msgData = await msgRes.json() as {
    value: Array<{ from: GraphEmailAddress; toRecipients: GraphEmailAddress[] }>;
  };

  const seen = new Set<string>();
  const queryLower = query.toLowerCase();
  for (const msg of msgData.value ?? []) {
    const addresses: GraphEmailAddress[] = [msg.from, ...(msg.toRecipients ?? [])].filter(Boolean);
    for (const addr of addresses) {
      const address = addr?.emailAddress?.address?.toLowerCase();
      const name = addr?.emailAddress?.name ?? '';
      if (!address) continue;
      if (address === email.toLowerCase()) continue;
      if (/^(no-?reply|noreply|notifications?|mailer-daemon|postmaster)@/i.test(address)) continue;
      if ((name.toLowerCase().includes(queryLower) || address.includes(queryLower)) && !seen.has(address)) {
        seen.add(address);
        results.push({ name: name || address, email: address, source: 'email_history' });
      }
    }
  }

  return results;
}
