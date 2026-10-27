import { z } from 'zod';
import { FormSchema, Id, Text, formIdentity } from './forms.js';
import { EvidenceSchema, SourceSchema } from './evidence.js';
import { NotableBearerSchema, OriginSchema, RelationshipSchema, StatisticSchema, UsageSchema } from './claims.js';

export const ResearchSchema = z.strictObject({
  schema_version: z.literal('1.0.0'),
  record_id: Id,
  input: z.strictObject({ name: Text, language: Text.optional() }),
  coverage: z.strictObject({
    status: z.enum(['in_progress', 'sources_exhausted', 'budget_stopped', 'partial_failure', 'review_required']),
    searched_sources: z.array(Text),
    notes: z.array(Text),
  }),
  sources: z.array(SourceSchema),
  evidence: z.array(EvidenceSchema),
  forms: z.array(FormSchema),
  origins: z.array(OriginSchema),
  relationships: z.array(RelationshipSchema),
  usages: z.array(UsageSchema),
  notable_bearers: z.array(NotableBearerSchema),
  statistics: z.array(StatisticSchema),
}).superRefine((record, ctx) => {
  function issue(path: (string | number)[], message: string) {
    ctx.addIssue({ code: 'custom', path, message });
  }
  function unique(values: string[], path: (string | number)[]) {
    const seen = new Set<string>();
    values.forEach((id, i) => {
      if (seen.has(id)) issue([...path, i], 'Duplicate identifier or value: ' + id);
      seen.add(id);
    });
  }
  const sourceIds = new Set(record.sources.map(source => source.id));
  const evidenceIds = new Set(record.evidence.map(evidence => evidence.id));
  const formIds = new Set(record.forms.map(form => form.id));
  const checkRef = (id: string, ids: Set<string>, path: (string | number)[]) => {
    if (!ids.has(id)) issue(path, 'Unknown reference: ' + id);
  };
  for (const key of ['sources', 'evidence', 'forms'] as const) {
    unique(record[key].map(item => item.id), [key]);
  }
  // Zod may run this refinement after recoverable child-field failures.
  // Never invoke the throwing public identity helper on an invalid child.
  unique(record.forms.flatMap(form => {
    const parsed = FormSchema.safeParse(form);
    return parsed.success ? [formIdentity(parsed.data)] : [];
  }), ['forms']);
  record.evidence.forEach((evidence, i) => checkRef(evidence.source_id, sourceIds, ['evidence', i, 'source_id']));
  const claimIds: string[] = [];
  for (const key of ['origins', 'relationships', 'usages', 'notable_bearers', 'statistics'] as const) {
    record[key].forEach((claim, i) => {
      claimIds.push(claim.id);
      unique(claim.evidence_ids, [key, i, 'evidence_ids']);
      claim.evidence_ids.forEach((id, j) => checkRef(id, evidenceIds, [key, i, 'evidence_ids', j]));
    });
  }
  if (claimIds.length !== new Set(claimIds).size) issue([], 'Claim IDs must be unique across all claim collections');
  record.origins.forEach((claim, i) => {
    checkRef(claim.root_form_id, formIds, ['origins', i, 'root_form_id']);
    unique(claim.original_variation_ids, ['origins', i, 'original_variation_ids']);
    claim.original_variation_ids.forEach((id, j) => checkRef(id, formIds, ['origins', i, 'original_variation_ids', j]));
    if (claim.meaning && !claim.meaning_language) issue(['origins', i, 'meaning_language'], 'Specify the language of the meaning translation');
  });
  record.relationships.forEach((claim, i) => {
    checkRef(claim.from_form_id, formIds, ['relationships', i, 'from_form_id']);
    checkRef(claim.to_form_id, formIds, ['relationships', i, 'to_form_id']);
  });
  record.usages.forEach((claim, i) => {
    checkRef(claim.form_id, formIds, ['usages', i, 'form_id']);
    unique(claim.genders, ['usages', i, 'genders']);
    unique(claim.countries, ['usages', i, 'countries']);
    if (claim.genders.includes('unknown') && claim.genders.length > 1) issue(['usages', i, 'genders'], 'Unknown gender cannot be combined with known classifications');
  });
  record.notable_bearers.forEach((claim, i) => {
    unique(claim.form_ids, ['notable_bearers', i, 'form_ids']);
    claim.form_ids.forEach((id, j) => checkRef(id, formIds, ['notable_bearers', i, 'form_ids', j]));
  });
  record.statistics.forEach((claim, i) => {
    checkRef(claim.form_id, formIds, ['statistics', i, 'form_id']);
    if (claim.period.start > claim.period.end) issue(['statistics', i, 'period'], 'Period start must not exceed end');
    if (claim.value === null && !claim.suppression_note) issue(['statistics', i, 'suppression_note'], 'Missing values require an explanation');
    if (claim.measure === 'rank' && claim.value === 0) issue(['statistics', i, 'value'], 'Rank starts at one');
  });
});
export type Research = z.infer<typeof ResearchSchema>;
