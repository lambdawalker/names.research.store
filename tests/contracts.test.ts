import { expect,it } from 'vitest';
import { ResearchTaskSchema, SaveResearchTaskSchema, GetResearchTaskSchema, GetFormByIdentitySchema, formIdentity } from '@lambdawalker/names-research-store/contracts';
it('exports validation and identity contracts through its package subpath',()=>{
  expect(ResearchTaskSchema).toBeDefined();expect(SaveResearchTaskSchema).toBeDefined();
  expect(GetResearchTaskSchema.parse({task_id:'root'})).toEqual({task_id:'root'});
  const form=GetFormByIdentitySchema.parse({id:'x',spelling:'John',language:{code:'en',name:'English'},script:'Latn',kind:'given_name',reconstructed:false,transliterations:[]});
  expect(formIdentity(form)).toBe(formIdentity({...form,id:'legacy'}));
});
