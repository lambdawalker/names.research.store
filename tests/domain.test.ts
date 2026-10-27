import { describe, expect, it } from 'vitest';
import {
  FormSchema, ClaimSchema, ResearchSchema, formIdentity, normalizeSearchKey,
  summarizeResearch,
} from '../src/index.js';

function form(id = 'it-giovanni', spelling = 'Giovanni', code = 'it', script = 'Latn') {
  return { id, spelling, language: { code, name: code }, script, kind: 'given_name' as const,
    reconstructed: false, transliterations: [] };
}

function record() {
  return {
    schema_version: '1.0.0', record_id: 'example', input: { name: 'Giovanni' },
    coverage: { status: 'in_progress', searched_sources: [], notes: [] },
    sources: [{ id: 'source', provider: 'synthetic', upstream_source: 'synthetic',
      retrieved_at: '2026-10-26T12:00:00Z', public_reuse: 'unknown' }],
    evidence: [{ id: 'evidence', source_id: 'source', locator: 'synthetic:example',
      supporting_text: 'Synthetic test evidence; not a historical claim.' }],
    forms: [form(), form('es-giovanni', 'Giovanni', 'es')],
    origins: [], relationships: [], usages: [], notable_bearers: [], statistics: [],
  };
}

const claim = { id: 'claim', status: 'supported', evidence_ids: ['evidence'] };

describe('name identity', () => {
  it('uses NFC while retaining diacritics in canonical identity', () => {
    expect(formIdentity(form('a', 'Jose\u0301'))).toBe(formIdentity(form('b', 'José')));
    expect(formIdentity(form('a', 'José'))).not.toBe(formIdentity(form('b', 'Jose')));
    expect(normalizeSearchKey('José')).toBe(normalizeSearchKey('Jose'));
  });
  it('distinguishes language, script, historical stage, kind and origin sense', () => {
    const base = form();
    for (const different of [form('b', 'Giovanni', 'es'), form('b', 'Giovanni', 'it', 'Cyrl'),
      { ...base, origin_sense: 'another-root' },
      { ...base, language: { ...base.language, stage: 'historical' } },
      { ...base, kind: 'surname' as const }]) {
      expect(formIdentity(base)).not.toBe(formIdentity(different));
    }
  });
  it('stores transliteration independently from spelling and normalizes spelling', () => {
    const parsed = FormSchema.parse({ ...form('he', 'יוחנן', 'he', 'Hebr'),
      transliterations: [{ text: 'Yōḥānān', system: 'unspecified scholarly' }] });
    expect(parsed.spelling).toBe('יוחנן');
    expect(parsed.transliterations[0]?.text).toBe('Yōḥānān');
    expect(FormSchema.parse(form('a', 'Jose\u0301')).spelling).toBe('José');
  });
});

describe('evidence and references', () => {
  it('returns nested validation failures without throwing for malformed forms', () => {
    for (const patch of [{ script: 'bad' }, { spelling: '' }, { id: 'bad id' }]) {
      const bad = record(); Object.assign(bad.forms[0]!, patch);
      expect(() => ResearchSchema.safeParse(bad)).not.toThrow();
      const result = ResearchSchema.safeParse(bad);
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.issues.some(i => i.path[0] === 'forms' && i.path[1] === 0)).toBe(true);
    }
  });
  it('rejects supported or disputed claims without evidence', () => {
    for (const status of ['supported', 'disputed']) {
      expect(ClaimSchema.safeParse({ id: 'a', status, evidence_ids: [] }).success).toBe(false);
    }
    expect(ClaimSchema.safeParse({ id: 'a', status: 'candidate', evidence_ids: [] }).success).toBe(true);
  });
  it('accepts an empty research result without manufacturing a root', () => {
    expect(ResearchSchema.parse(record()).origins).toEqual([]);
  });
  it('rejects unknown fields and unsupported schema versions', () => {
    expect(ResearchSchema.safeParse({ ...record(), schema_version: '99' }).success).toBe(false);
    expect(ResearchSchema.safeParse({ ...record(), confidence: 0.99 }).success).toBe(false);
  });
  it('rejects duplicate form IDs and missing source/evidence/form references', () => {
    const duplicate = record(); duplicate.forms.push(form());
    expect(ResearchSchema.safeParse(duplicate).success).toBe(false);
    const missingSource = record(); missingSource.evidence[0]!.source_id = 'missing';
    expect(ResearchSchema.safeParse(missingSource).success).toBe(false);
    expect(ResearchSchema.safeParse({ ...record(), origins: [
      { ...claim, root_form_id: 'missing', original_variation_ids: [], meaning: 'test' },
    ] }).success).toBe(false);
    expect(ResearchSchema.safeParse({ ...record(), usages: [
      { ...claim, form_id: 'it-giovanni', genders: ['male'], countries: [], evidence_ids: ['missing'] },
    ] }).success).toBe(false);
  });
  it('retains multiple, conflicting origins', () => {
    const parsed = ResearchSchema.parse({ ...record(), origins: [
      { ...claim, id: 'root-a', root_form_id: 'it-giovanni', original_variation_ids: [] },
      { ...claim, id: 'root-b', status: 'disputed', root_form_id: 'es-giovanni', original_variation_ids: [] },
    ] });
    expect(parsed.origins).toHaveLength(2);
  });
  it('rejects self relationships but permits cycles between distinct forms', () => {
    const edge = { ...claim, from_form_id: 'es-giovanni', to_form_id: 'it-giovanni', type: 'borrowed_from' };
    expect(ResearchSchema.safeParse({ ...record(), relationships: [
      { ...edge, to_form_id: 'es-giovanni' },
    ] }).success).toBe(false);
    expect(ResearchSchema.safeParse({ ...record(), relationships: [edge,
      { ...edge, id: 'return', from_form_id: 'it-giovanni', to_form_id: 'es-giovanni' },
    ] }).success).toBe(true);
  });
  it('requires locator and meaningful evidence content', () => {
    expect(ResearchSchema.safeParse({ ...record(), evidence: [
      { id: 'evidence', source_id: 'source', locator: '', supporting_text: '' },
    ] }).success).toBe(false);
  });
});

describe('language summary', () => {
  it('keeps Spanish usage separate from an Italian borrowing claim', () => {
    const data = ResearchSchema.parse({ ...record(), usages: [
      { ...claim, id: 'use-it', form_id: 'it-giovanni', genders: ['male'], countries: [] },
      { ...claim, id: 'use-es', form_id: 'es-giovanni', genders: ['male'], countries: [] },
    ] });
    expect(summarizeResearch(data).relationships).toEqual([]);
    const withBorrowing = ResearchSchema.parse({ ...data, relationships: [
      { ...claim, from_form_id: 'es-giovanni', to_form_id: 'it-giovanni', type: 'borrowed_from' },
    ] });
    const summary = summarizeResearch(withBorrowing);
    expect(summary.relationships[0]?.type).toBe('borrowed_from');
    const es = summary.languages.find(l => l.language.code === 'es');
    expect(es?.adaptations.male?.[0]?.form_id).toBe('es-giovanni');
  });
  it('omits unverified claims by default and preserves status when opted in', () => {
    const data = ResearchSchema.parse({ ...record(), usages: [
      { ...claim, status: 'candidate', form_id: 'it-giovanni', genders: ['male'], countries: [] },
    ] });
    expect(summarizeResearch(data).languages).toEqual([]);
    expect(summarizeResearch(data, { includeUnverified: true }).languages[0]
      ?.adaptations.male?.[0]?.usages[0]?.status).toBe('candidate');
  });
  it('keeps distinct origin senses with the same spelling in a language', () => {
    const data = ResearchSchema.parse({ ...record(), forms: [form(),
      { ...form('it-other'), origin_sense: 'different' }], usages: [
      { ...claim, id: 'a', form_id: 'it-giovanni', genders: ['unisex'], countries: [] },
      { ...claim, id: 'b', form_id: 'it-other', genders: ['unisex'], countries: [] },
    ] });
    expect(summarizeResearch(data).languages[0]?.adaptations.unisex).toHaveLength(2);
  });
});

describe('remaining storage invariants', () => {
  const statistic = { ...claim, form_id: 'it-giovanni', measure: 'birth_count', value: 12,
    period: { start: '2020-01-01', end: '2020-12-31' },
    geography: { country: 'IT' }, dataset_version: 'synthetic-v1', population_scope: 'Synthetic test births' };

  it('distinguishes suppressed data from zero and rejects inverted periods', () => {
    expect(ResearchSchema.safeParse({ ...record(), statistics: [statistic] }).success).toBe(true);
    expect(ResearchSchema.safeParse({ ...record(), statistics: [{ ...statistic, value: 0 }] }).success).toBe(true);
    expect(ResearchSchema.safeParse({ ...record(), statistics: [{ ...statistic, value: null }] }).success).toBe(false);
    expect(ResearchSchema.safeParse({ ...record(), statistics: [
      { ...statistic, value: null, suppression_note: 'Suppressed in synthetic source' },
    ] }).success).toBe(true);
    expect(ResearchSchema.safeParse({ ...record(), statistics: [
      { ...statistic, period: { start: '2021-01-01', end: '2020-01-01' } },
    ] }).success).toBe(false);
    expect(ResearchSchema.safeParse({ ...record(), statistics: [
      { ...statistic, measure: 'rank', value: 0 },
    ] }).success).toBe(false);
  });
  it('rejects claim ID collisions across different collections', () => {
    expect(ResearchSchema.safeParse({ ...record(), statistics: [statistic], usages: [
      { ...claim, form_id: 'it-giovanni', genders: ['male'], countries: [] },
    ] }).success).toBe(false);
  });
  it('rejects repeated canonical forms even if their caller IDs differ', () => {
    expect(ResearchSchema.safeParse({ ...record(), forms: [form(), form('alias-id')] }).success).toBe(false);
  });
  it('requires an explicit meaning translation language', () => {
    const origin = { ...claim, root_form_id: 'it-giovanni', original_variation_ids: [], meaning: 'Example only' };
    expect(ResearchSchema.safeParse({ ...record(), origins: [origin] }).success).toBe(false);
    expect(ResearchSchema.safeParse({ ...record(), origins: [{ ...origin, meaning_language: 'en' }] }).success).toBe(true);
  });
  it('rejects dangling bearer and origin-variation references', () => {
    expect(ResearchSchema.safeParse({ ...record(), notable_bearers: [
      { ...claim, name: 'Synthetic Person', form_ids: ['missing'] },
    ] }).success).toBe(false);
    expect(ResearchSchema.safeParse({ ...record(), origins: [
      { ...claim, root_form_id: 'it-giovanni', original_variation_ids: ['missing'] },
    ] }).success).toBe(false);
  });
  it('rejects mixed known and unknown gender classifications', () => {
    expect(ResearchSchema.safeParse({ ...record(), usages: [
      { ...claim, form_id: 'it-giovanni', genders: ['male', 'unknown'], countries: [] },
    ] }).success).toBe(false);
  });
});
