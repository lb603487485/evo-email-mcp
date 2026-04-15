import { google } from 'googleapis';
import { getGmailAuthClient } from '../auth/oauth-gmail';

export interface Contact {
  name: string;
  email: string;
  source: 'contacts' | 'email_history';
}

export async function lookupContact(email: string, query: string): Promise<Contact[]> {
  const auth = await getGmailAuthClient(email);

  // Try Google Contacts first
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
    const emails = person.emailAddresses ?? [];
    for (const e of emails) {
      if (e.value) {
        results.push({ name, email: e.value, source: 'contacts' });
      }
    }
  }

  if (results.length > 0) return results;

  // Fallback: search email history for this person
  const gmail = google.gmail({ version: 'v1', auth });
  const searchRes = await gmail.users.messages.list({
    userId: 'me',
    q: query,
    maxResults: 10,
  });

  const seen = new Set<string>();
  for (const msg of searchRes.data.messages ?? []) {
    const full = await gmail.users.messages.get({ userId: 'me', id: msg.id!, format: 'metadata', metadataHeaders: ['From', 'To'] });
    const headers: Array<{ name: string; value: string }> = (full.data.payload?.headers ?? []) as any;
    for (const h of headers) {
      if (h.name === 'From' || h.name === 'To') {
        const addresses = h.value.split(',');
        for (const addr of addresses) {
          const match = addr.match(/(?:"?([^"<]*)"?\s*)?<?([^>]+@[^>]+)>?/);
          if (match) {
            const name = (match[1] || '').trim();
            const emailAddr = match[2].trim().toLowerCase();
            const nameLower = name.toLowerCase();
            const queryLower = query.toLowerCase();
            if (emailAddr === email.toLowerCase()) continue; // skip self
            if (/^(no-?reply|noreply|notifications?|mailer-daemon|postmaster)@/i.test(emailAddr)) continue; // skip automated
            if (/@(linkedin\.com|zoom\.us|glassdoor\.com|github\.com|google\.com|googlemail\.com)$/i.test(emailAddr) && !emailAddr.includes(queryLower)) continue; // skip platform noreply
            if (nameLower.includes(queryLower) || emailAddr.includes(queryLower)) {
              if (!seen.has(emailAddr)) {
                seen.add(emailAddr);
                results.push({ name: name || emailAddr, email: emailAddr, source: 'email_history' });
              }
            }
          }
        }
      }
    }
  }

  return results;
}
