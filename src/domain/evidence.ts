import { z } from 'zod';
import { Id, Text } from './forms.js';

export const SourceSchema = z.strictObject({
  id: Id,
  provider: Text,
  upstream_source: Text,
  url: z.url().optional(),
  retrieved_at: z.iso.datetime({ offset: true }),
  revision: Text.optional(),
  license: z.strictObject({ name: Text, url: z.url().optional() }).optional(),
  public_reuse: z.enum(['allowed', 'restricted', 'unknown']),
});
export const EvidenceSchema = z.strictObject({
  id: Id,
  source_id: Id,
  locator: Text,
  document_id: Text.regex(/^[a-f0-9]{64}$/).optional(),
  fragment_id: Text.regex(/^[a-f0-9]{64}$/).optional(),
  supporting_text: Text.optional(),
  note: Text.optional(),
}).refine(evidence => !!(evidence.supporting_text || evidence.note), {
  message: 'Evidence requires a supporting passage or a source-specific note',
}).refine(evidence => !evidence.fragment_id || !!evidence.document_id, {
  message: 'Fragment evidence requires its document ID', path: ['document_id'],
});
export type Source = z.infer<typeof SourceSchema>;
export type Evidence = z.infer<typeof EvidenceSchema>;
