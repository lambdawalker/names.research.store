import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { Store } from '../src/store.js';
const dirs: string[] = []; const stores: Store[] = [];
afterEach(() => { stores.splice(0).forEach(s => s.close()); dirs.splice(0).forEach(d => rmSync(d, {recursive:true,force:true})); });
function open(directory?: string, clock?: () => number) {
  const dir = directory ?? mkdtempSync(join(tmpdir(), 'names-store-')); if (!directory) dirs.push(dir);
  const store = new Store(dir, clock); stores.push(store); return { store, dir };
}
const source = { id:'s1', provider:'synthetic',upstream_source:'synthetic',retrieved_at:'2026-10-26T00:00:00Z',public_reuse:'unknown' };
const form = { id:'en-john',spelling:'John',language:{code:'en',name:'English'},script:'Latn',kind:'given_name',reconstructed:false,transliterations:[] };
const batch = { idempotency_key:'first',sources:[source],forms:[form] };

it('journals findings idempotently and rejects key/payload conflicts', () => {
  const {store}=open();
  const first=store.recordFinding(batch); expect(first.projection).toBe('pending');
  expect(store.recordFinding(batch).finding_id).toBe(first.finding_id);
  expect(()=>store.recordFinding({...batch,forms:[]})).toThrow(/conflict/i);
  expect(store.status().pending).toBe(1);
});
it('resolves cross-finding references and rolls back invalid batches', () => {
  const {store}=open(); store.recordFinding(batch);
  store.recordFinding({idempotency_key:'second',evidence:[{id:'e1',source_id:'s1',locator:'synthetic:1',note:'Synthetic only'}],
    usages:[{id:'u1',form_id:'en-john',genders:['male'],countries:[],status:'supported',evidence_ids:['e1']}]});
  expect(()=>store.recordFinding({idempotency_key:'bad',forms:[{...form,id:'fr-jean',spelling:'Jean'}],
    relationships:[{id:'r1',from_form_id:'fr-jean',to_form_id:'missing',type:'derived_from',status:'candidate',evidence_ids:[]}]})).toThrow();
  expect(store.findForms({query:'Jean'})).toHaveLength(0);
  expect(store.status().findings).toBe(2);
});
it('rejects immutable identity changes and aliases of an existing canonical form', () => {
  const {store}=open();store.recordFinding(batch);
  expect(()=>store.recordFinding({idempotency_key:'change',forms:[{...form,spelling:'Jane'}]})).toThrow(/immutable/i);
  expect(()=>store.recordFinding({idempotency_key:'alias',forms:[{...form,id:'alias'}]})).toThrow(/identity/i);
});
it('retains journal and pending work across reopening', () => {
  const {store,dir}=open();store.recordFinding(batch);store.close();stores.pop();
  const reopened=open(dir).store;expect(reopened.status().pending).toBe(1);
});
it('stores deduplicated Markdown with exact fragment hashes and metadata-only retention', () => {
  const {store,dir}=open();
  const a=store.storeDocument({source,locator:'synthetic:a',content:'<p>John יוֹחָנָן</p>',format:'html',retention:'allowed'});
  const b=store.storeDocument({source,locator:'synthetic:b',content:'<p class="x">John יוֹחָנָן</p>',format:'html',retention:'allowed'});
  expect(a.document_id).not.toBe(b.document_id);
  expect(readdirSync(join(dir,'documents'))).toHaveLength(1);
  const fragment=store.createFragment({document_id:a.document_id,start:0,end:4});
  expect(fragment.text).toBe('John');expect(fragment.sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(store.getFragment(fragment.fragment_id).text).toBe('John');
  const metadata=store.storeDocument({source,locator:'synthetic:c',content:'Private source',format:'text',retention:'metadata_only'});
  expect(()=>store.readDocument({document_id:metadata.document_id})).toThrow(/retained/i);
  expect(readdirSync(join(dir,'documents'))).toHaveLength(1);
});
it('scopes cache keys, canonicalizes parameters and expires without deleting evidence', () => {
  let now=0;const {store}=open(undefined,()=>now);
  const key={provider:'p',operation:'search',scope:'public',parameters:{language:'en',name:'John'}};
  store.cacheSearch({key,value:[],ttl_seconds:10});
  expect(store.getCachedSearch({...key,parameters:{name:'John',language:'en'}})?.value).toEqual([]);
  expect(store.getCachedSearch({...key,scope:'account-b'})).toBeNull();
  store.storeDocument({source,locator:'synthetic:a',content:'John',format:'text',retention:'allowed'});
  now=11000;expect(store.getCachedSearch(key)).toBeNull();expect(store.pruneCache().deleted).toBe(1);
  expect(store.status().documents).toBe(1);
});
it('retries projection after failure without duplicating admission', async () => {
  const {store}=open();store.recordFinding(batch);
  const failed=await store.projectPending({apply:async()=>{throw new Error('offline');}});
  expect(failed.failed).toBe(1);expect(store.status().pending).toBe(1);
  let applied=0;
  await store.projectPending({apply:async()=>{applied++;}});
  await store.projectPending({apply:async()=>{applied++;}});
  expect(applied).toBe(1);expect(store.status().pending).toBe(0);
});
it('distinguishes conversion formats for identical source bytes in either ingestion order',()=>{
  for(const order of [['html','text'],['text','html']] as const){
    const {store}=open();
    const documents=order.map(format=>store.storeDocument({source,locator:'synthetic:same',content:'<p>John</p>',format,retention:'allowed'}));
    expect(documents[0]!.document_id).not.toBe(documents[1]!.document_id);
    for(let i=0;i<documents.length;i++){
      const read=store.readDocument({document_id:documents[i]!.document_id});
      expect(read.metadata).toEqual(documents[i]);
      expect(read.text).toBe(order[i]==='html'?'John\n':'<p>John</p>\n');
    }
  }
});
it('hydrates and replays more existing references than the submission array limit',async()=>{
  const {store}=open();
  const forms=Array.from({length:202},(_,i)=>({...form,id:'form-'+i,spelling:'Synthetic'+i}));
  store.recordFinding({idempotency_key:'forms-a',forms:forms.slice(0,101)});
  store.recordFinding({idempotency_key:'forms-b',forms:forms.slice(101)});
  const relationships=Array.from({length:101},(_,i)=>({id:'relation-'+i,from_form_id:'form-'+(i*2),
    to_form_id:'form-'+(i*2+1),type:'derived_from',status:'candidate',evidence_ids:[]}));
  expect(()=>store.recordFinding({idempotency_key:'references',relationships})).not.toThrow();
  let maxForms=0;
  const result=await store.projectPending({apply:async(_id,finding)=>{maxForms=Math.max(maxForms,finding.forms.length);}});
  expect(result.applied).toBe(3);expect(maxForms).toBe(202);
});
