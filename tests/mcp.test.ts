import { Client,InMemoryTransport } from '@modelcontextprotocol/client';
import { expect,it } from 'vitest';
import { createMcpProxy } from '../src/mcp-proxy.js';

it('lists validated tools and forwards an MCP call over HTTP without exposing credentials',async()=>{
  let header='';let requested='';
  const fetcher:typeof fetch=async(input,init)=>{
    requested=String(input);header=new Headers(init?.headers).get('authorization')??'';
    return new Response(JSON.stringify({findings:0,pending:0}),{headers:{'content-type':'application/json'}});
  };
  const server=createMcpProxy('http://127.0.0.1:4318','test-token-with-at-least-32-characters',fetcher);
  const client=new Client({name:'test',version:'1.0.0'});
  const [a,b]=InMemoryTransport.createLinkedPair();
  try{
    await server.connect(a);await client.connect(b);
    const tools=await client.listTools();expect(tools.tools.some(t=>t.name==='store_document')).toBe(true);
    expect(JSON.stringify(tools)).not.toContain('test-token');
    expect(tools.tools.find(t=>t.name==='get_form_by_identity')?.annotations?.readOnlyHint).toBe(true);
    expect(tools.tools.find(t=>t.name==='get_research_task')?.annotations?.readOnlyHint).toBe(true);
    expect(tools.tools.find(t=>t.name==='save_research_task')?.annotations?.readOnlyHint).toBe(false);
    expect(tools.tools.find(t=>t.name==='save_research_task')?.inputSchema).toMatchObject({type:'object'});
    await client.callTool({name:'get_research_task',arguments:{task_id:'root-task'}});
    expect(requested).toBe('http://127.0.0.1:4318/v1/operations/get_research_task');
    const result=await client.callTool({name:'get_status',arguments:{}});
    expect(result.isError).not.toBe(true);
    expect(JSON.stringify(result)).toContain('findings');
    expect(requested).toBe('http://127.0.0.1:4318/v1/operations/get_status');
    expect(header).toMatch(/^Bearer /);
  }finally{await client.close();await server.close();}
});

it('bounds streamed responses before buffering an unbounded service body',async()=>{
 let cancelled=false,pulls=0;const fetcher:typeof fetch=async()=>new Response(new ReadableStream({pull(c){if(++pulls<=3)c.enqueue(new Uint8Array(200000));else c.close();},cancel(){cancelled=true;}}));const server=createMcpProxy('http://127.0.0.1:4318','test-token-with-at-least-32-characters',fetcher),client=new Client({name:'test',version:'1'});const[a,b]=InMemoryTransport.createLinkedPair();try{await server.connect(a);await client.connect(b);const result=await client.callTool({name:'get_status',arguments:{}});expect(result.isError).toBe(true);expect(cancelled).toBe(true);expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(131072);}finally{await client.close();await server.close();}
});
it('does not echo credentials reflected by the HTTP service',async()=>{const token='test-token-with-at-least-32-characters';const server=createMcpProxy('http://127.0.0.1:4318',token,async()=>new Response(JSON.stringify({error:token}))),client=new Client({name:'test',version:'1'});const[a,b]=InMemoryTransport.createLinkedPair();try{await server.connect(a);await client.connect(b);const result=await client.callTool({name:'get_status',arguments:{}});expect(result.isError).toBe(true);expect(JSON.stringify(result)).not.toContain(token);}finally{await client.close();await server.close();}});
it('bounds unknown root argument errors before SDK formatting',async()=>{let requests=0;const server=createMcpProxy('http://127.0.0.1:4318','test-token-with-at-least-32-characters',async()=>{requests++;return new Response('{}');}),client=new Client({name:'test',version:'1'});const[a,b]=InMemoryTransport.createLinkedPair();try{await server.connect(a);await client.connect(b);const result=await client.callTool({name:'get_status',arguments:{['x'.repeat(200000)]:1}});expect(result.isError).toBe(true);expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(131072);expect(requests).toBe(0);}finally{await client.close();await server.close();}});
it('performs real database writes and reads through the built stdio MCP over authenticated HTTP',async()=>{
 const{StdioClientTransport}=await import('@modelcontextprotocol/client/stdio');const{mkdtemp,rm}=await import('node:fs/promises');const{tmpdir}=await import('node:os');const{join}=await import('node:path');const{Store}=await import('../src/store.js');const{createApi}=await import('../src/http.js');const{randomBytes}=await import('node:crypto');const dir=await mkdtemp(join(tmpdir(),'store-mcp-'));const store=new Store(dir),token=randomBytes(32).toString('hex'),api=createApi(store,token),client=new Client({name:'stdio-e2e',version:'1'});
 try{await new Promise<void>(resolve=>api.listen(0,'127.0.0.1',resolve));const address=api.address();if(!address||typeof address==='string')throw Error('address');await client.connect(new StdioClientTransport({command:process.execPath,args:['dist/mcp.js'],env:{...process.env as Record<string,string>,STORE_API_URL:`http://127.0.0.1:${address.port}`,STORE_API_TOKEN:token},stderr:'pipe'}));const finding=await client.callTool({name:'record_finding',arguments:{idempotency_key:'stdio-mcp-fixture',forms:[{id:'john-en',spelling:'John',language:{code:'en',name:'English'},script:'Latn',kind:'given_name',reconstructed:false,transliterations:[]}]}});expect(finding.isError).not.toBe(true);const read=await client.callTool({name:'get_entity',arguments:{collection:'forms',id:'john-en'}});expect(JSON.stringify(read)).toContain('John');expect(JSON.stringify(read)).not.toContain(token);
 }finally{await client.close();await new Promise<void>(resolve=>api.close(()=>resolve()));store.close();await rm(dir,{recursive:true,force:true});}
});
it('filters tokens after JSON Unicode escapes have been decoded',async()=>{const token='test-token-with-at-least-32-characters';const escaped=[...token].map(c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0')).join('');const server=createMcpProxy('http://127.0.0.1:4318',token,async()=>new Response('{"error":"'+escaped+'"}')),client=new Client({name:'test',version:'1'});const[a,b]=InMemoryTransport.createLinkedPair();try{await server.connect(a);await client.connect(b);const result=await client.callTool({name:'get_status',arguments:{}});expect(result.isError).toBe(true);expect(JSON.stringify(result)).not.toContain(token);}finally{await client.close();await server.close();}});
