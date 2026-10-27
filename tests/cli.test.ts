import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, expect, it } from 'vitest';

const temporary: string[] = [];
afterEach(() => temporary.splice(0).forEach(path => rmSync(path, { recursive: true, force: true })));
function run(command: string, ...args: string[]) {
  return spawnSync(process.execPath, [`dist/cli/${command}.js`, ...args], { encoding: 'utf8' });
}

it('validates the full user draft without accepting its etymology as researched', () => {
  const result = run('validate', 'examples/juan-family.draft.json');
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain('Valid');
});

it('preserves all 33 supplied language groups only when unverified output is requested', () => {
  const restricted = run('summarize', 'examples/juan-family.draft.json');
  expect(restricted.status, restricted.stderr).toBe(0);
  expect(JSON.parse(restricted.stdout).languages).toEqual([]);
  const full = run('summarize', 'examples/juan-family.draft.json', '--include-unverified');
  expect(full.status, full.stderr).toBe(0);
  const result = JSON.parse(full.stdout);
  expect(result.languages).toHaveLength(33);
  expect(result.includes_unverified).toBe(true);
  expect(result.origin_and_etymology[0].status).toBe('candidate');
});

it('rejects a malformed document with a nonzero exit and no stack trace', () => {
  const directory = mkdtempSync(join(tmpdir(), 'name-research-')); temporary.push(directory);
  const path = join(directory, 'invalid.json'); writeFileSync(path, '{}');
  const result = run('validate', path);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('schema_version');
  expect(result.stderr).not.toContain('at Module');
});

it('prints usage for missing arguments and rejects unknown flags', () => {
  expect(run('validate').status).toBe(1);
  expect(run('summarize', 'examples/juan-family.draft.json', '--typo').status).toBe(1);
});

it('keeps the committed illustrative fixture free of supported claims', () => {
  const fixture = JSON.parse(readFileSync('examples/juan-family.draft.json', 'utf8'));
  for (const key of ['origins', 'relationships', 'usages', 'notable_bearers', 'statistics']) {
    expect(fixture[key].every((claim: { status: string }) => claim.status === 'candidate')).toBe(true);
  }
});
