import { google } from 'googleapis';
import { getGmailAuthClient } from '../auth/oauth-gmail';
import { getOutlookAuthClient } from '../auth/oauth-outlook';
import { AccountConfig } from './interface';

export interface Contact {
  name: string;
  email: string;
  source: 'contacts' | 'email_history';
}

export interface ContactFields {
  name?: string;
  email: string;
  phone?: string;
  company?: string;
  title?: string;
}

type GraphEmailAddress = { emailAddress: { name?: string; address: string } };

export async function lookupContact(acc: AccountConfig, query: string): Promise<Contact[]> {
  if (acc.provider === 'outlook') return outlookLookupContact(acc.email, query);
  return gmailLookupContact(acc.email, query);
}

export async function createContact(acc: AccountConfig, fields: ContactFields): Promise<void> {
  if (acc.provider === 'outlook') return outlookCreateContact(acc.email, fields);
  return gmailCreateContact(acc.email, fields);
}

export async function updateContact(acc: AccountConfig, fields: ContactFields): Promise<void> {
  if (acc.provider === 'outlook') return outlookUpdateContact(acc.email, fields);
  return gmailUpdateContact(acc.email, fields);
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
    const emails = person.emailAddresses ?? [];
    for (const e of emails) {
      if (e.value) results.push({ name, email: e.value, source: 'contacts' });
    }
  }

  // Try Google Contacts first
  if (results.length > 0) return results;

  // Fallback: search email history for this person
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
        const queryLower = query.toLowerCase();
        if (/@(linkedin\.com|zoom\.us|glassdoor\.com|github\.com|google\.com|googlemail\.com)$/i.test(emailAddr) && !emailAddr.includes(queryLower)) continue;
        if ((name.toLowerCase().includes(queryLower) || emailAddr.includes(queryLower)) && !seen.has(emailAddr)) {
          seen.add(emailAddr);
          results.push({ name: name || emailAddr, email: emailAddr, source: 'email_history' });
        }
      }
    }
  }

  return results;
}

async function gmailCreateContact(accountEmail: string, fields: ContactFields): Promise<void> {
  const auth = await getGmailAuthClient(accountEmail);
  const people = google.people({ version: 'v1', auth });

  const requestBody: any = {
    names: [{ givenName: fields.name }],
    emailAddresses: [{ value: fields.email }],
  };
  if (fields.phone) requestBody.phoneNumbers = [{ value: fields.phone }];
  if (fields.company || fields.title) {
    requestBody.organizations = [{ name: fields.company, title: fields.title }];
  }

  await people.people.createContact({ requestBody });
}

async function gmailUpdateContact(accountEmail: string, fields: ContactFields): Promise<void> {
  const auth = await getGmailAuthClient(accountEmail);
  const people = google.people({ version: 'v1', auth });

  // Find contact by email
  const searchRes = await people.people.searchContacts({
    query: fields.email,
    readMask: 'names,emailAddresses',
    pageSize: 10,
  });

  let resourceName: string | undefined;
  for (const result of searchRes.data.results ?? []) {
    const emails = result.person?.emailAddresses ?? [];
    if (emails.some(e => e.value?.toLowerCase() === fields.email.toLowerCase())) {
      resourceName = result.person?.resourceName ?? undefined;
      break;
    }
  }

  if (!resourceName) {
    throw new Error(`No contact found with email ${fields.email}. Use email_create_contact instead.`);
  }

  // Get current contact to retrieve etag
  const current = await people.people.get({
    resourceName,
    personFields: 'names,emailAddresses,phoneNumbers,organizations',
  });

  const updatePersonFields: string[] = [];
  const requestBody: any = { etag: current.data.etag };

  if (fields.name) {
    requestBody.names = [{ givenName: fields.name }];
    updatePersonFields.push('names');
  }
  if (fields.phone) {
    requestBody.phoneNumbers = [{ value: fields.phone }];
    updatePersonFields.push('phoneNumbers');
  }
  if (fields.company || fields.title) {
    requestBody.organizations = [{
      name: fields.company,
      title: fields.title,
    }];
    updatePersonFields.push('organizations');
  }

  await people.people.updateContact({
    resourceName,
    updatePersonFields: updatePersonFields.join(','),
    requestBody,
  });
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

async function outlookCreateContact(accountEmail: string, fields: ContactFields): Promise<void> {
  const { accessToken } = await getOutlookAuthClient(accountEmail);

  const body: any = {
    givenName: fields.name,
    emailAddresses: [{ address: fields.email, name: fields.name ?? fields.email }],
  };
  if (fields.phone) body.businessPhones = [fields.phone];
  if (fields.company) body.companyName = fields.company;
  if (fields.title) body.jobTitle = fields.title;

  const res = await fetch('https://graph.microsoft.com/v1.0/me/contacts', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error(`Create contact failed: ${await res.text()}`);
}

async function outlookUpdateContact(accountEmail: string, fields: ContactFields): Promise<void> {
  const { accessToken } = await getOutlookAuthClient(accountEmail);
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };

  // Find contact by email
  const searchRes = await fetch(
    `https://graph.microsoft.com/v1.0/me/contacts?$filter=emailAddresses/any(e:e/address eq '${fields.email}')&$top=1`,
    { headers }
  );
  if (!searchRes.ok) throw new Error(`Contact search failed: ${await searchRes.text()}`);
  const searchData = await searchRes.json() as { value: Array<{ id: string }> };

  if (!searchData.value?.length) {
    throw new Error(`No contact found with email ${fields.email}. Use email_create_contact instead.`);
  }

  const contactId = searchData.value[0].id;
  const body: any = {};
  if (fields.name) body.givenName = fields.name;
  if (fields.phone) body.businessPhones = [fields.phone];
  if (fields.company) body.companyName = fields.company;
  if (fields.title) body.jobTitle = fields.title;

  const patchRes = await fetch(
    `https://graph.microsoft.com/v1.0/me/contacts/${contactId}`,
    { method: 'PATCH', headers, body: JSON.stringify(body) }
  );
  if (!patchRes.ok) throw new Error(`Update contact failed: ${await patchRes.text()}`);
}
