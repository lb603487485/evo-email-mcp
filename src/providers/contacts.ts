import { google } from 'googleapis';
import { getGmailAuthClient } from '../auth/oauth-gmail';

export interface Contact {
  name: string;
  email: string;
}

export async function lookupContact(email: string, query: string): Promise<Contact[]> {
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
    const emails = person.emailAddresses ?? [];
    for (const e of emails) {
      if (e.value) {
        results.push({ name, email: e.value });
      }
    }
  }

  return results;
}
