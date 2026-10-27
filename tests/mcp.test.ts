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
    const result=await client.callTool({name:'get_status',arguments:{}});
    expect(result.isError).not.toBe(true);
    expect(JSON.stringify(result)).toContain('findings');
    expect(requested).toBe('http://127.0.0.1:4318/v1/operations/get_status');
    expect(header).toMatch(/^Bearer /);
  }finally{await client.close();await server.close();}
});
