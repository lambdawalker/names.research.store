import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {expect,it} from 'vitest';
import {Store} from '../src/store.js';
it('validates evidence links to retained document fragments and their original source',()=>{
  const dir=mkdtempSync(join(tmpdir(),'names-evidence-')),store=new Store(dir);
  const source={id:'s',provider:'synthetic',upstream_source:'synthetic',retrieved_at:'2026-10-26T00:00:00Z',public_reuse:'unknown'};
  try{
    const document=store.storeDocument({source,locator:'synthetic:john',content:'John',format:'markdown',retention:'allowed'});
    const fragment=store.createFragment({document_id:document.document_id,start:0,end:4});
    const evidence={id:'e',source_id:'s',locator:'synthetic:john',note:'Synthetic test',document_id:document.document_id,fragment_id:fragment.fragment_id};
    expect(()=>store.recordFinding({idempotency_key:'evidence',evidence:[evidence]})).not.toThrow();
    expect(()=>store.recordFinding({idempotency_key:'missing',evidence:[{...evidence,id:'e2',document_id:'0'.repeat(64)}]})).toThrow();
    expect(()=>store.recordFinding({idempotency_key:'fragment',evidence:[{...evidence,id:'e3',fragment_id:'0'.repeat(64)}]})).toThrow();
  }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
