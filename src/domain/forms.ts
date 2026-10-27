import { z } from 'zod';

export const Text = z.string().trim().min(1);
export const Id = Text.regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
export const LanguageSchema = z.strictObject({
  code: Text.regex(/^[a-z]{2,8}(?:-[a-z0-9]{1,8})*$/),
  name: Text,
  stage: Text.optional(),
});
export const GenderSchema = z.enum(['male', 'female', 'unisex', 'unknown']);
export const FormSchema = z.strictObject({
  id: Id,
  spelling: Text.transform(text => text.normalize('NFC')),
  language: LanguageSchema,
  script: Text.regex(/^[A-Z][a-z]{3}$/),
  kind: z.enum(['given_name', 'surname', 'component', 'title', 'marital_form', 'unknown']),
  origin_sense: Text.optional(),
  reconstructed: z.boolean(),
  transliterations: z.array(z.strictObject({ text: Text, system: Text.optional() })),
});
export type Form = z.infer<typeof FormSchema>;
export type Language = z.infer<typeof LanguageSchema>;
export type Gender = z.infer<typeof GenderSchema>;

/** Accent/case-folding is for discovery only, never for canonical identity. */
export function normalizeSearchKey(input: string): string {
  return input.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim().normalize('NFC');
}

/** Caller IDs, language labels and transliteration conventions do not define identity. */
export function formIdentity(input: z.input<typeof FormSchema>): string {
  const form = FormSchema.parse(input);
  return JSON.stringify([form.spelling, form.language.code, form.language.stage ?? null,
    form.script, form.kind, form.origin_sense ?? null, form.reconstructed]);
}
