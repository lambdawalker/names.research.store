import { createHash } from 'node:crypto';
import TurndownService from 'turndown';

export class DocumentError extends Error {
  constructor(public status:400|413,message:string){super(message);}
}

export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, item]) => JSON.stringify(key) + ':' + canonicalJson(item)).join(',') + '}';
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error('Value is not JSON');
  return encoded;
}
export function normalizeDocument(content: string, format: 'html' | 'markdown' | 'text' | 'json') {
  const rawBytes = Buffer.byteLength(content, 'utf8');
  if (rawBytes > 1_048_576) throw new DocumentError(413,'Source exceeds 1 MiB');
  if (!content.trim()) throw new DocumentError(400,'Source is empty');
  let markdown: string;
  if (format === 'html') {
    const converter = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
    converter.remove(['script', 'style', 'nav', 'iframe', 'noscript', 'form']);
    markdown = converter.turndown(content);
  } else if (format === 'json') {
    let json:string;
    try{json=JSON.stringify(JSON.parse(content),null,2);}catch{throw new DocumentError(400,'Source contains invalid JSON');}
    const longest = Math.max(0, ...[...json.matchAll(/`+/g)].map(match => match[0].length));
    const fence = '`'.repeat(Math.max(3, longest + 1));
    markdown = `${fence}json\n${json}\n${fence}`;
  } else {
    markdown = content;
  }
  markdown = markdown.replace(/\r\n?/g, '\n').trim() + '\n';
  if (!markdown.trim()) throw new DocumentError(400,'No evidence text remains after normalization');
  const markdownBytes = Buffer.byteLength(markdown, 'utf8');
  if (markdownBytes > 1_048_576) throw new DocumentError(413,'Normalized document exceeds 1 MiB');
  return { markdown, raw_sha256: sha256(content), markdown_sha256: sha256(markdown),
    input_bytes: rawBytes, markdown_bytes: markdownBytes, converter: 'markdown-v1/turndown-7.2.4' };
}
