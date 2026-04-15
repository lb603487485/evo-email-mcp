import { Draft } from './interface';

export function encodeHeader(value: string): string {
  if (/^[\x00-\x7F]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf-8').toString('base64')}?=`;
}

export function applyInline(text: string, bold: string = 'b', italic: string = 'i'): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, `<${bold}>$1</${bold}>`)
    .replace(/\*(.+?)\*/g, `<${italic}>$1</${italic}>`);
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Gmail style: Arial, small, #222222, <b>/<i>, <br><br> for line breaks, <div> wrapper
export function gmailTemplate(body: string): string {
  const lines = escapeHtml(body).split('\n');
  const html: string[] = [];
  let inList = false;

  for (const line of lines) {
    const h3 = line.match(/^###\s+(.+)/);
    if (h3) { if (inList) { html.push('</ul>'); inList = false; } html.push(`<h3>${applyInline(h3[1])}</h3>`); continue; }
    const h2 = line.match(/^##\s+(.+)/);
    if (h2) { if (inList) { html.push('</ul>'); inList = false; } html.push(`<h2>${applyInline(h2[1])}</h2>`); continue; }
    const h1 = line.match(/^#\s+(.+)/);
    if (h1) { if (inList) { html.push('</ul>'); inList = false; } html.push(`<h1>${applyInline(h1[1])}</h1>`); continue; }

    const bullet = line.match(/^[\-\*]\s+(.+)/);
    if (bullet) {
      if (!inList) { html.push('<ul>'); inList = true; }
      html.push(`<li>${applyInline(bullet[1])}</li>`);
      continue;
    }

    if (inList) { html.push('</ul>'); inList = false; }
    if (line.trim() === '') { html.push('<br>'); continue; }
    html.push(`<div>${applyInline(line)}</div>`);
  }

  if (inList) html.push('</ul>');

  return [
    '<div dir="ltr">',
    `<div style="font-family:arial,sans-serif;font-size:small;color:#222222">`,
    html.join('\n'),
    '</div>',
    '</div>',
  ].join('\n');
}

// Outlook style: Calibri, 11pt, <p class="MsoNormal">, <b>/<i>
export function outlookTemplate(body: string): string {
  const lines = escapeHtml(body).split('\n');
  const html: string[] = [];
  let inList = false;

  for (const line of lines) {
    const h3 = line.match(/^###\s+(.+)/);
    if (h3) { if (inList) { html.push('</ul>'); inList = false; } html.push(`<h3 style="font-family:Calibri,sans-serif">${applyInline(h3[1])}</h3>`); continue; }
    const h2 = line.match(/^##\s+(.+)/);
    if (h2) { if (inList) { html.push('</ul>'); inList = false; } html.push(`<h2 style="font-family:Calibri,sans-serif">${applyInline(h2[1])}</h2>`); continue; }
    const h1 = line.match(/^#\s+(.+)/);
    if (h1) { if (inList) { html.push('</ul>'); inList = false; } html.push(`<h1 style="font-family:Calibri,sans-serif">${applyInline(h1[1])}</h1>`); continue; }

    const bullet = line.match(/^[\-\*]\s+(.+)/);
    if (bullet) {
      if (!inList) { html.push('<ul>'); inList = true; }
      html.push(`<li style="margin:0;font-size:11pt;font-family:Calibri,sans-serif">${applyInline(bullet[1])}</li>`);
      continue;
    }

    if (inList) { html.push('</ul>'); inList = false; }
    if (line.trim() === '') { html.push(`<p class="MsoNormal" style="margin:0;font-size:11pt;font-family:Calibri,sans-serif">&nbsp;</p>`); continue; }
    html.push(`<p class="MsoNormal" style="margin:0;font-size:11pt;font-family:Calibri,sans-serif">${applyInline(line)}</p>`);
  }

  if (inList) html.push('</ul>');
  return html.join('\n');
}

// IMAP default: clean, no provider-specific styling
export function imapTemplate(body: string): string {
  const lines = escapeHtml(body).split('\n');
  const html: string[] = [];
  let inList = false;

  for (const line of lines) {
    const h3 = line.match(/^###\s+(.+)/);
    if (h3) { if (inList) { html.push('</ul>'); inList = false; } html.push(`<h3>${applyInline(h3[1], 'strong', 'em')}</h3>`); continue; }
    const h2 = line.match(/^##\s+(.+)/);
    if (h2) { if (inList) { html.push('</ul>'); inList = false; } html.push(`<h2>${applyInline(h2[1], 'strong', 'em')}</h2>`); continue; }
    const h1 = line.match(/^#\s+(.+)/);
    if (h1) { if (inList) { html.push('</ul>'); inList = false; } html.push(`<h1>${applyInline(h1[1], 'strong', 'em')}</h1>`); continue; }

    const bullet = line.match(/^[\-\*]\s+(.+)/);
    if (bullet) {
      if (!inList) { html.push('<ul>'); inList = true; }
      html.push(`<li>${applyInline(bullet[1], 'strong', 'em')}</li>`);
      continue;
    }

    if (inList) { html.push('</ul>'); inList = false; }
    if (line.trim() === '') { html.push('<br>'); continue; }
    html.push(`<p>${applyInline(line, 'strong', 'em')}</p>`);
  }

  if (inList) html.push('</ul>');
  return html.join('\n');
}

export type HtmlTemplate = (body: string) => string;

export function buildMimeMessage(draft: Draft, template: HtmlTemplate): string {
  const to = Array.isArray(draft.to) ? draft.to.join(', ') : draft.to;
  const boundary = `boundary_${Date.now()}`;
  const htmlBody = template(draft.body);

  const mime = [
    `From: ${draft.from}`,
    `To: ${to}`,
    `Subject: ${encodeHeader(draft.subject)}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    ``,
    `--${boundary}`,
    `Content-Type: text/plain; charset=UTF-8`,
    ``,
    draft.body,
    ``,
    `--${boundary}`,
    `Content-Type: text/html; charset=UTF-8`,
    ``,
    htmlBody,
    ``,
    `--${boundary}--`,
  ].join('\r\n');
  return Buffer.from(mime).toString('base64url');
}
