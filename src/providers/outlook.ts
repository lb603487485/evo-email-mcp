import { writeFileSync } from 'fs';
import { getOutlookAuthClient } from '../auth/oauth-outlook';
import { Email, EmailProvider, SearchQuery, Draft, Label } from './interface';

type GraphEmailAddress = { emailAddress: { name?: string; address: string } };

interface GraphMessage {
  id: string;
  conversationId: string;
  from: GraphEmailAddress;
  toRecipients: GraphEmailAddress[];
  subject: string;
  body: { contentType: string; content: string };
  receivedDateTime: string;
  categories: string[];
  hasAttachments: boolean;
  attachments?: GraphAttachment[];
}

interface GraphAttachment {
  id: string;
  name: string;
  contentType: string;
  size: number;
  contentBytes?: string;
}

export class OutlookProvider implements EmailProvider {
  private accessToken: string;
  private email: string;

  private constructor(accessToken: string, email: string) {
    this.accessToken = accessToken;
    this.email = email;
  }

  static async create(email: string): Promise<OutlookProvider> {
    const { accessToken } = await getOutlookAuthClient(email);
    return new OutlookProvider(accessToken, email);
  }

  private async graphGet<T>(path: string): Promise<T> {
    const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });
    if (!res.ok) throw new Error(`Graph API error ${res.status}: ${await res.text()}`);
    return res.json() as Promise<T>;
  }

  private async graphPost(path: string, body: unknown): Promise<void> {
    const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Graph API error ${res.status}: ${await res.text()}`);
  }

  private async graphPatch(path: string, body: unknown): Promise<void> {
    const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Graph API error ${res.status}: ${await res.text()}`);
  }

  async search(query: SearchQuery): Promise<Email[]> {
    const top = query.maxResults ?? 20;
    const data = await this.graphGet<{ value: GraphMessage[] }>(
      `/me/messages?$search="${query.q}"&$top=${top}`
    );
    return (data.value ?? []).map(m => this.parseMessage(m));
  }

  async getEmail(id: string): Promise<Email> {
    const msg = await this.graphGet<GraphMessage>(`/me/messages/${id}?$expand=attachments`);
    return this.parseMessage(msg);
  }

  async send(draft: Draft): Promise<void> {
    const to = Array.isArray(draft.to) ? draft.to : [draft.to];
    await this.graphPost('/me/sendMail', {
      message: {
        subject: draft.subject,
        body: { contentType: isHtml(draft.body) ? 'HTML' : 'Text', content: draft.body },
        toRecipients: to.map(a => ({ emailAddress: { address: a } })),
      },
    });
  }

  async createDraft(draft: Draft): Promise<Draft> {
    const to = Array.isArray(draft.to) ? draft.to : [draft.to];
    await this.graphPost('/me/messages', {
      subject: draft.subject,
      body: { contentType: isHtml(draft.body) ? 'HTML' : 'Text', content: draft.body },
      toRecipients: to.map(a => ({ emailAddress: { address: a } })),
    });
    return draft;
  }

  async listLabels(): Promise<Label[]> {
    const data = await this.graphGet<{ value: Array<{ id: string; displayName: string }> }>('/me/mailFolders');
    return (data.value ?? []).map(f => ({ id: f.id, name: f.displayName }));
  }

  async applyLabel(id: string, label: string, action: 'add' | 'remove'): Promise<void> {
    await this.graphPatch(`/me/messages/${id}`, {
      parentFolderId: action === 'add' ? label : 'inbox',
    });
  }

  async downloadAttachment(emailId: string, attachmentId: string, savePath: string): Promise<void> {
    const attachment = await this.graphGet<GraphAttachment>(
      `/me/messages/${emailId}/attachments/${attachmentId}`
    );
    if (!attachment.contentBytes) throw new Error('Attachment has no content');
    writeFileSync(savePath, Buffer.from(attachment.contentBytes, 'base64'));
  }

  private parseMessage(msg: GraphMessage): Email {
    return {
      id: msg.id,
      threadId: msg.conversationId,
      account: this.email,
      provider: 'outlook',
      from: {
        name: msg.from?.emailAddress?.name,
        email: msg.from?.emailAddress?.address ?? '',
      },
      to: (msg.toRecipients ?? []).map(r => ({
        name: r.emailAddress?.name,
        email: r.emailAddress?.address ?? '',
      })),
      subject: msg.subject ?? '',
      body: msg.body?.content ?? '',
      date: new Date(msg.receivedDateTime),
      labels: msg.categories ?? [],
      attachments: (msg.attachments ?? []).map(a => ({
        id: a.id,
        filename: a.name,
        mimeType: a.contentType,
        size: a.size,
      })),
    };
  }
}

function isHtml(text: string): boolean {
  return /<[a-z][\s\S]*>/i.test(text);
}
