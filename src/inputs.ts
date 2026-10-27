import { z } from 'zod';
import { FormSchema, Id, Text } from './domain/forms.js';
import { SourceSchema, EvidenceSchema } from './domain/evidence.js';
import { OriginSchema, RelationshipSchema, UsageSchema, NotableBearerSchema, StatisticSchema } from './domain/claims.js';

export const collections = ['forms', 'sources', 'evidence', 'origins', 'relationships', 'usages', 'notable_bearers', 'statistics'] as const;
export type Collection = typeof collections[number];
export const FindingSchema = z.strictObject({
  idempotency_key: Id.max(128),
  forms: z.array(FormSchema).max(200).default([]),
  sources: z.array(SourceSchema).max(200).default([]),
  evidence: z.array(EvidenceSchema).max(200).default([]),
  origins: z.array(OriginSchema).max(200).default([]),
  relationships: z.array(RelationshipSchema).max(200).default([]),
  usages: z.array(UsageSchema).max(200).default([]),
  notable_bearers: z.array(NotableBearerSchema).max(200).default([]),
  statistics: z.array(StatisticSchema).max(200).default([]),
}).refine(input => collections.some(key => input[key].length), 'Finding must contain at least one entity');
export type Finding = z.infer<typeof FindingSchema>;
/** Internal dependency hydration is not constrained by per-submission array caps. */
export const ProjectionFindingSchema = FindingSchema.safeExtend({
  forms: z.array(FormSchema).max(2000),
  sources: z.array(SourceSchema).max(2000),
  evidence: z.array(EvidenceSchema).max(2000),
});
export const DocumentInputSchema = z.strictObject({
  source: SourceSchema,
  locator: Text.max(4096),
  content: z.string().max(1_048_576),
  format: z.enum(['html', 'markdown', 'text', 'json']),
  retention: z.enum(['allowed', 'metadata_only']),
});
export const CacheKeySchema = z.strictObject({
  provider: Text.max(128), operation: Text.max(128), scope: Text.max(256), parameters: z.json(),
});
export const CacheWriteSchema = z.strictObject({
  key: CacheKeySchema, value: z.json(), ttl_seconds: z.number().int().min(1).max(604800),
});
export const ReadDocumentSchema = z.strictObject({
  document_id: Text.regex(/^[a-f0-9]{64}$/), offset: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(16000).default(8000),
});
export const FragmentSchema = z.strictObject({
  document_id: Text.regex(/^[a-f0-9]{64}$/), start: z.number().int().min(0),
  end: z.number().int().min(1),
}).refine(input => input.end > input.start && input.end - input.start <= 16000, 'Fragment must be 1–16000 UTF-16 units');
export const FindFormsSchema = z.strictObject({
  query: Text.max(256), language: Text.optional(), limit: z.number().int().min(1).max(100).default(20),
});
export const TraverseSchema = z.strictObject({
  form_id: Id, depth: z.number().int().min(1).max(6).default(3),
  limit: z.number().int().min(1).max(100).default(25),
});
