import type { Claim, Usage } from './claims.js';
import type { Form, Gender, Language } from './forms.js';
import { ResearchSchema, type Research } from './research.js';

export interface SummaryAdaptation {
  form_id: string;
  spelling: string;
  script: string;
  kind: Form['kind'];
  origin_sense?: string;
  reconstructed: boolean;
  transliterations: Form['transliterations'];
  usages: Usage[];
}

/** Private research view, not a public-data licensing/export gate. */
export function summarizeResearch(input: Research, options: { includeUnverified?: boolean } = {}) {
  const record = ResearchSchema.parse(input);
  const visible = (claim: Claim) => options.includeUnverified || claim.status === 'supported';
  const forms = new Map(record.forms.map(form => [form.id, form]));
  const groups = new Map<string, { language: Language; adaptations: Partial<Record<Gender, SummaryAdaptation[]>> }>();
  for (const usage of record.usages.filter(visible)) {
    const form = forms.get(usage.form_id)!;
    const groupId = JSON.stringify([form.language.code, form.language.stage ?? null]);
    let group = groups.get(groupId);
    if (!group) {
      group = { language: form.language, adaptations: {} };
      groups.set(groupId, group);
    }
    for (const gender of usage.genders) {
      const entries = group.adaptations[gender] ??= [];
      let adaptation = entries.find(entry => entry.form_id === form.id);
      if (!adaptation) {
        const { id, language: _language, ...details } = form;
        adaptation = { form_id: id, ...details, usages: [] };
        entries.push(adaptation);
      }
      adaptation.usages.push(usage);
    }
  }
  return {
    schema_version: record.schema_version,
    record_id: record.record_id,
    input: record.input,
    coverage: record.coverage,
    includes_unverified: !!options.includeUnverified,
    origin_and_etymology: record.origins.filter(visible).map(origin => ({ ...origin,
      root: forms.get(origin.root_form_id)!,
      original_variations: origin.original_variation_ids.map(id => forms.get(id)!),
    })),
    languages: [...groups.values()].sort((a, b) => a.language.code.localeCompare(b.language.code, 'en')),
    relationships: record.relationships.filter(visible),
    // Keep referenced node definitions, including filtered-out usage, so edges remain resolvable.
    forms: record.forms,
    notable_bearers: record.notable_bearers.filter(visible),
    statistics: record.statistics.filter(visible),
    evidence: record.evidence,
    sources: record.sources,
  };
}
