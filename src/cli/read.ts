import { readFile } from 'node:fs/promises';
import { ResearchSchema } from '../domain/research.js';

export async function readResearch(path: string) {
  const raw: unknown = JSON.parse(await readFile(path, 'utf8'));
  const parsed = ResearchSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map(issue => `${issue.path.join('.') || '(document)'}: ${issue.message}`).join('\n'));
  }
  return parsed.data;
}

export function printError(error: unknown): void {
  console.error('ERROR: ' + (error instanceof Error ? error.message : 'Unable to process document'));
  process.exitCode = 1;
}
