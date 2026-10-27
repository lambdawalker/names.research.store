import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { Store } from '../src/store.js';
const dirs:string[]=[];const stores:Store[]=[];
afterEach(()=>{stores.splice(0).forEach(s=>s.close());dirs.splice(0).forEach(d=>rmSync(d,{recursive:true,force:true}));});
function open(dir?:string){if(!dir){dir=mkdtempSync(join(tmpdir(),'root-tasks-'));dirs.push(dir);}const store=new Store(dir,()=>0);stores.push(store);return {store,dir};}
const task={id:'root-a',input:{name:'John',language:'en'},phase:'root',status:'pending',checkpoint:{pending_finding:null},finding_ids:[],session_ids:[],stats:{sessions:0,model_calls:0,tool_calls:0}};
const request={task,expected_revision:0,write_id:'write-a'};
it('saves with CAS and replays the original receipt across revisions and restart',()=>{
  const {store,dir}=open();expect(store.getResearchTask({task_id:'absent'})).toBeNull();
  const first=store.saveResearchTask(request);expect(first).toEqual({task,revision:1,updated_at:'1970-01-01T00:00:00.000Z'});
  expect(store.saveResearchTask({...request,task:{...task,status:'running'},expected_revision:1,write_id:'write-b'}).revision).toBe(2);
  expect(()=>store.saveResearchTask({...request,write_id:'stale'})).toThrow(/revision/i);
  expect(()=>store.saveResearchTask({...request,expected_revision:1})).toThrow(/write/i);
  expect(()=>store.saveResearchTask({...request,task:{...task,id:'another'}})).toThrow(/write/i);
  store.close();stores.pop();const reopened=open(dir).store;
  expect(reopened.saveResearchTask(request)).toEqual(first);
  expect(reopened.getResearchTask({task_id:task.id})?.revision).toBe(2);
  expect(reopened.status()).toMatchObject({findings:0,pending:0});
});
it('rejects immutable input changes and missing findings atomically',()=>{
  const {store}=open();store.saveResearchTask(request);
  expect(()=>store.saveResearchTask({...request,task:{...task,input:{name:'Jane'}},expected_revision:1,write_id:'change'})).toThrow(/immutable/i);
  expect(()=>store.saveResearchTask({...request,task:{...task,finding_ids:['a'.repeat(64)]},expected_revision:1,write_id:'missing'})).toThrow(/finding/i);
  expect(store.getResearchTask({task_id:task.id})?.revision).toBe(1);
  const finding=store.recordFinding({idempotency_key:'form',forms:[{id:'john',spelling:'John',language:{code:'en',name:'English'},script:'Latn',kind:'given_name',reconstructed:false,transliterations:[]}]});
  expect(store.saveResearchTask({...request,task:{...task,finding_ids:[finding.finding_id]},expected_revision:1,write_id:'missing'}).revision).toBe(2);
});
it('bounds JSON bytes, collection lengths and task inputs',()=>{
  const {store}=open();
  for(const patch of [{checkpoint:{text:'😀'.repeat(9000)}},{checkpoint:{a:'x'.repeat(32700),b:'x'.repeat(32700)}},{input:{name:'x'.repeat(257)}},{session_ids:Array(101).fill('session')},{stats:{sessions:-1,model_calls:0,tool_calls:0}},{phase:'other'}]){
    expect(()=>store.saveResearchTask({...request,task:{...task,...patch}})).toThrow();
  }
  expect(()=>store.saveResearchTask({...request,task:{...task,checkpoint:'x'.repeat(32760),finding_ids:Array(100).fill('a'.repeat(64)),session_ids:Array(100).fill('s'.repeat(512))}})).toThrow(/KiB/);
});
it('hydrates existing origin subjects and rejects dangling subjects',async()=>{
  const {store}=open();const form={id:'subject',spelling:'John',language:{code:'en',name:'English'},script:'Latn',kind:'given_name',reconstructed:false,transliterations:[]};
  store.recordFinding({idempotency_key:'subject',forms:[form]});
  const origin={id:'origin',status:'candidate',evidence_ids:[],root_form_id:'root',subject_form_id:'subject',original_variation_ids:[]};
  store.recordFinding({idempotency_key:'origin',forms:[{...form,id:'root',spelling:'Root'}],origins:[origin]});
  expect(()=>store.recordFinding({idempotency_key:'bad',origins:[{...origin,id:'bad',subject_form_id:'missing'}]})).toThrow();
  let hydrated=false;await store.projectPending({apply:async(_id,finding)=>{if(finding.origins.length)hydrated=finding.forms.some(f=>f.id==='subject');}});expect(hydrated).toBe(true);
});
it('looks up canonical form identity without replacing legacy form metadata',()=>{
  const {store}=open();const form={id:'legacy-john',spelling:'John',language:{code:'en',name:'English'},script:'Latn',kind:'given_name',reconstructed:false,transliterations:[{text:'John',system:'legacy'}]};
  store.recordFinding({idempotency_key:'legacy',forms:[form]});
  expect(store.getFormByIdentity({...form,id:'proposed',transliterations:[]})).toEqual(form);
  expect(store.getFormByIdentity({...form,language:{code:'fr',name:'French'}})).toBeNull();
});
it('serializes revisions across two connections and preserves rejected write IDs',()=>{
  const {store,dir}=open();const other=open(dir).store;
  store.saveResearchTask(request);
  expect(()=>other.saveResearchTask({...request,write_id:'retry'})).toThrow(/revision/);
  expect(other.saveResearchTask({...request,expected_revision:1,write_id:'retry'}).revision).toBe(2);
  expect(store.getResearchTask({task_id:task.id})?.revision).toBe(2);
});
