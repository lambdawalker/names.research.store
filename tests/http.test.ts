import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { afterEach,expect,it } from 'vitest';
import { Store } from '../src/store.js';
import { createApi } from '../src/http.js';
const cleanup:(()=>Promise<void>)[]=[];
afterEach(async()=>{for(const fn of cleanup.splice(0))await fn();});
const token='test-token-with-at-least-32-characters';
async function start(){
  const directory=mkdtempSync(join(tmpdir(),'names-http-')),store=new Store(directory);
  const server=createApi(store,token);server.listen(0,'127.0.0.1');await once(server,'listening');
  const port=(server.address() as {port:number}).port;
  cleanup.push(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));store.close();rmSync(directory,{recursive:true,force:true});});
  return {base:`http://127.0.0.1:${port}`,store};
}
function headers(){return {'authorization':`Bearer ${token}`,'content-type':'application/json'};}
it('requires authentication for operations and serves health without credentials',async()=>{
  const {base}=await start();expect((await fetch(base+'/health')).status).toBe(200);
  expect((await fetch(base+'/v1/operations/get_status',{method:'POST',body:'{}'})).status).toBe(401);
  const response=await fetch(base+'/v1/operations/get_status',{method:'POST',headers:headers(),body:'{}'});
  expect(response.status).toBe(200);expect(await response.json()).toMatchObject({findings:0,pending:0});
});
it('rejects malformed payloads and arbitrary database commands',async()=>{
  const {base}=await start();
  expect((await fetch(base+'/v1/operations/record_finding',{method:'POST',headers:headers(),body:'{}'})).status).toBe(400);
  expect((await fetch(base+'/v1/operations/execute_sql',{method:'POST',headers:headers(),body:'{}'})).status).toBe(404);
  expect((await fetch(base+'/v1/operations/get_status',{method:'POST',headers:headers(),body:'oops'})).status).toBe(400);
});
it('commits incremental findings through HTTP and reports unavailable graph queries',async()=>{
  const {base}=await start();
  const response=await fetch(base+'/v1/operations/record_finding',{method:'POST',headers:headers(),body:JSON.stringify({idempotency_key:'a',
    forms:[{id:'john-en',spelling:'John',language:{code:'en',name:'English'},script:'Latn',kind:'given_name',reconstructed:false,transliterations:[]}]})});
  expect(response.status).toBe(200);expect(await response.json()).toMatchObject({projection:'pending'});
  const graph=await fetch(base+'/v1/operations/get_ancestry',{method:'POST',headers:headers(),body:JSON.stringify({form_id:'john-en'})});
  expect(graph.status).toBe(503);
});
it('rejects requests larger than 2 MiB with a readable response',async()=>{
  const {base}=await start();
  const response=await fetch(base+'/v1/operations/get_status',{method:'POST',headers:headers(),body:'a'.repeat(2097153)});
  expect(response.status).toBe(413);
});
it('reports invalid and oversized source documents as client input errors',async()=>{
  const {base}=await start();
  const source={id:'s',provider:'synthetic',upstream_source:'synthetic',retrieved_at:'2026-10-26T00:00:00Z',public_reuse:'unknown'};
  for(const [format,content,status] of [['json','invalid JSON',400],['text','  ',400],['text','😀'.repeat(300000),413]] as const){
    const response=await fetch(base+'/v1/operations/store_document',{method:'POST',headers:headers(),
      body:JSON.stringify({source,locator:'test:invalid',format,content,retention:'allowed'})});
    expect(response.status).toBe(status);
    expect(await response.text()).not.toContain('configuration');
  }
});
it('saves and reads root tasks over HTTP with conflict and validation responses',async()=>{
  const {base}=await start();
  const task={id:'http-root',input:{name:'John'},phase:'root',status:'pending',checkpoint:{pending_finding:null},finding_ids:[],session_ids:[],stats:{sessions:0,model_calls:0,tool_calls:0}};
  const call=(name:string,input:unknown)=>fetch(base+'/v1/operations/'+name,{method:'POST',headers:headers(),body:JSON.stringify(input)});
  expect(await (await call('get_research_task',{task_id:'http-root'})).json()).toBeNull();
  const saved=await call('save_research_task',{task,expected_revision:0,write_id:'http-write'});expect(saved.status).toBe(200);
  expect(await saved.json()).toMatchObject({task,revision:1,updated_at:expect.any(String)});
  expect(await (await call('get_research_task',{task_id:'http-root'})).json()).toMatchObject({task,revision:1});
  expect((await call('save_research_task',{task,expected_revision:0,write_id:'stale'})).status).toBe(409);
  expect((await call('save_research_task',{task:{...task,finding_ids:['a'.repeat(64)]},expected_revision:1,write_id:'missing'})).status).toBe(400);
  expect((await call('save_research_task',{task:{...task,checkpoint:'😀'.repeat(9000)},expected_revision:1,write_id:'large'})).status).toBe(413);
});
it('looks up legacy forms by canonical identity over HTTP',async()=>{
  const {base,store}=await start();
  const form={id:'legacy',spelling:'John',language:{code:'en',name:'English'},script:'Latn',kind:'given_name',reconstructed:false,transliterations:[]};
  store.recordFinding({idempotency_key:'lookup',forms:[form]});
  const response=await fetch(base+'/v1/operations/get_form_by_identity',{method:'POST',headers:headers(),body:JSON.stringify({...form,id:'proposed'})});
  expect(response.status).toBe(200);expect(await response.json()).toEqual(form);
});
