import {readFile} from 'node:fs/promises';
import {parseDocument} from 'yaml';
import {z} from 'zod';
import {randomUUID} from 'node:crypto';
import { resolve } from 'node:path';
import { Store } from './store.js';
import { Neo4jGraph } from './graph.js';
import { createApi } from './http.js';

const yamlText=await readFile(new URL('../config.default.yaml',import.meta.url),'utf8');if(Buffer.byteLength(yamlText)>65536)throw Error('Store config exceeds limit');const doc=parseDocument(yamlText,{uniqueKeys:true});if(doc.errors.length)throw Error('Invalid store YAML');const config=z.strictObject({host:z.literal('127.0.0.1'),port:z.number().int().min(1).max(65535),dataDir:z.string().min(1),graph:z.strictObject({uri:z.string(),user:z.string().default('neo4j'),database:z.string().default('neo4j')}).optional()}).parse(doc.toJS({maxAliasCount:0}));
const managed=process.env.NAMES_CONTROL_TOKEN?{controlToken:process.env.NAMES_CONTROL_TOKEN,bootId:process.env.NAMES_BOOT_ID??randomUUID()}:undefined;
const token=process.env.STORE_API_TOKEN??'';
if(!managed&&token.length<32)throw new Error('Set STORE_API_TOKEN to at least 32 random characters');
const port=Number(process.env.NAMES_SERVICE_PORT??process.env.STORE_PORT??config.port);
if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Invalid STORE_PORT');
const store=new Store(resolve(process.env.STORE_DATA_DIR??config.dataDir));
let graph:Neo4jGraph|undefined;
const graphUri=process.env.NEO4J_URI??config.graph?.uri;
if(graphUri){
  if(!process.env.NEO4J_PASSWORD)throw new Error('Set NEO4J_PASSWORD when NEO4J_URI is configured');
  graph=new Neo4jGraph(graphUri,process.env.NEO4J_USER??config.graph?.user??'neo4j',process.env.NEO4J_PASSWORD,process.env.NEO4J_DATABASE??config.graph?.database??'neo4j');
  try{await graph.initialize();}catch{console.error('Graph unavailable at startup; durable journal remains available and projections will retry.');}
}
const server=createApi(store,managed??token,graph);
server.listen(port,managed?'127.0.0.1':process.env.STORE_HOST??config.host,()=>console.error(`Research store listening on port ${port}`));
const timer=setInterval(()=>{if(graph)void store.projectPending(graph).catch(()=>console.error('Projection worker failed; pending work retained.'));},5000);
let closing=false;
async function shutdown(){
  if(closing)return;closing=true;clearInterval(timer);
  await new Promise<void>(resolve=>server.close(()=>resolve()));
  if(graph){await store.projectPending(graph).catch(()=>{});await graph.close();}
  store.close();
}
process.once('SIGINT',()=>void shutdown());process.once('SIGTERM',()=>void shutdown());
