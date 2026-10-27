import { z } from 'zod';
import { GenderSchema, Id, Text } from './forms.js';

export const ClaimStatusSchema = z.enum(['supported', 'disputed', 'candidate', 'unresolved']);
export const ClaimSchema = z.strictObject({
  id: Id,
  status: ClaimStatusSchema,
  evidence_ids: z.array(Id),
  interpretation: Text.optional(),
}).refine(claim => !['supported', 'disputed'].includes(claim.status) || claim.evidence_ids.length > 0, {
  message: 'Supported and disputed claims require evidence', path: ['evidence_ids'],
});
export const OriginSchema = ClaimSchema.safeExtend({
  root_form_id: Id,
  subject_form_id: Id.optional(),
  original_variation_ids: z.array(Id),
  meaning: Text.optional(),
  meaning_language: Text.optional(),
});
export const RelationshipTypeSchema = z.enum([
  'derived_from', 'borrowed_from', 'transliteration_of', 'diminutive_of',
  'spelling_variant_of', 'feminine_form_of', 'masculine_form_of',
]);
/** Direction is always dependent/recipient -> antecedent/donor. */
export const RelationshipSchema = ClaimSchema.safeExtend({
  from_form_id: Id,
  to_form_id: Id,
  type: RelationshipTypeSchema,
}).refine(edge => edge.from_form_id !== edge.to_form_id, {
  message: 'A relationship must connect distinct forms', path: ['to_form_id'],
});
export const UsageSchema = ClaimSchema.safeExtend({
  form_id: Id,
  genders: z.array(GenderSchema).min(1),
  countries: z.array(Text.regex(/^[A-Z]{2}$/)),
});
export const NotableBearerSchema = ClaimSchema.safeExtend({
  name: Text,
  form_ids: z.array(Id).min(1),
  wikidata_id: Text.regex(/^Q[1-9][0-9]*$/).optional(),
  description: Text.optional(),
});
export const StatisticSchema = ClaimSchema.safeExtend({
  form_id: Id,
  measure: z.enum(['birth_count', 'population_count', 'rank']),
  value: z.number().int().nonnegative().nullable(),
  period: z.strictObject({ start: z.iso.date(), end: z.iso.date() }),
  geography: z.strictObject({
    country: Text.regex(/^[A-Z]{2}$/),
    region: Text.optional(),
  }),
  dataset_version: Text,
  population_scope: Text,
  suppression_note: Text.optional(),
});
export type Claim = z.infer<typeof ClaimSchema>;
export type Origin = z.infer<typeof OriginSchema>;
export type Relationship = z.infer<typeof RelationshipSchema>;
export type Usage = z.infer<typeof UsageSchema>;
export type Statistic = z.infer<typeof StatisticSchema>;
export type NotableBearer = z.infer<typeof NotableBearerSchema>;
