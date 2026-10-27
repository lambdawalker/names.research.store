import { createServer,type IncomingMessage } from 'node:http';
import { createHash,timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { Store,StoreError } from './store.js';
import type { Neo4jGraph } from './graph.js';
import { isOperationName,operate } from './operations.js';
import { DocumentError } from './documents.js';

function readBody(req:IncomingMessage):Promise<string>{
  return new Promise((resolve,reject)=>{
    const chunks:Buffer[]=[];let bytes=0,failed=false;
    req.on('data',(chunk:Buffer)=>{
      if(failed)return;
      bytes+=chunk.length;
      if(bytes>2097152){failed=true;chunks.length=0;reject(new StoreError(413,'Request exceeds 2 MiB'));return;}
      chunks.push(chunk);
    });
    req.on('end',()=>{if(!failed)resolve(Buffer.concat(chunks).toString('utf8'));});
    req.on('error',reject);
    req.on('aborted',()=>reject(new StoreError(400,'Request aborted')));
  });
}
export function createApi(store:Store,token:string,graph?:Neo4jGraph){
  if(token.length<32)throw new Error('STORE_API_TOKEN must have at least 32 characters');
  const digest=(value:string)=>createHash('sha256').update(value).digest();
  const expected=digest('Bearer '+token);
  const server=createServer(async(req,res)=>{
    const send=(status:number,value:unknown)=>{
      let body=JSON.stringify(value);
      if(Buffer.byteLength(body)>131072){status=413;body=JSON.stringify({error:'Response exceeds 128 KiB; request a smaller page or traversal limit'});}
      res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(body);
    };
    try{
      if(req.method==='GET'&&req.url==='/health'){send(200,{service:'names.research.store',status:'alive'});return;}
      if(!timingSafeEqual(expected,digest(req.headers.authorization??''))){req.resume();send(401,{error:'Unauthorized'});return;}
      const name=req.url?.match(/^\/v1\/operations\/([a-z_]+)$/)?.[1];
      if(req.method!=='POST'||!name||!isOperationName(name)){req.resume();send(404,{error:'Operation not found'});return;}
      if(!req.headers['content-type']?.startsWith('application/json')){req.resume();send(415,{error:'Use application/json'});return;}
      const raw=await readBody(req);
      let input:unknown;try{input=JSON.parse(raw);}catch{throw new StoreError(400,'Invalid JSON');}
      send(200,await operate(store,name,input,graph));
    }catch(error){
      if(res.writableEnded||res.destroyed)return;
      if(error instanceof z.ZodError){send(400,{error:'Validation failed',issues:error.issues.map(i=>({path:i.path,message:i.message}))});}
      else if(error instanceof StoreError||error instanceof DocumentError)send(error.status,{error:error.message});
      else send(500,{error:'Operation failed; inspect service configuration and retry'});
    }
  });
  server.requestTimeout=15000;server.headersTimeout=10000;
  return server;
}
