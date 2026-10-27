import { expect, it } from 'vitest';
import { normalizeDocument } from '../src/documents.js';

it('converts HTML without rewriting the native words or keeping executable clutter', () => {
  const result = normalizeDocument('<nav>menu</nav><script>bad()</script><style>css</style><h1>John</h1><p>יוֹחָנָן — gracious</p>', 'html');
  expect(result.markdown).toContain('יוֹחָנָן — gracious');
  expect(result.markdown).toContain('John');
  expect(result.markdown).not.toMatch(/bad\(\)|menu|css/);
  expect(result.raw_sha256).toMatch(/^[0-9a-f]{64}$/);
  expect(result.markdown_sha256).not.toBe(result.raw_sha256);
});
it('deduplicates normalized content while preserving original hashes', () => {
  const a = normalizeDocument('<p>John</p>', 'html');
  const b = normalizeDocument('<p class="x">John</p>', 'html');
  expect(a.markdown_sha256).toBe(b.markdown_sha256);
  expect(a.raw_sha256).not.toBe(b.raw_sha256);
});
it('preserves JSON values including markup-like text inside a fenced block', () => {
  const result = normalizeDocument('{"name":"<John>","count":12}', 'json');
  expect(result.markdown).toContain('"<John>"');
  expect(result.markdown).toContain('"count": 12');
});
it('rejects empty or oversized source bodies', () => {
  expect(() => normalizeDocument('   ', 'markdown')).toThrow();
  expect(() => normalizeDocument('a'.repeat(1_048_577), 'text')).toThrow();
});
