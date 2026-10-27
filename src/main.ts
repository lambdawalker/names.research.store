import { resolve } from 'node:path';
import { Store } from './store.js';
import { Neo4jGraph } from './graph.js';
import { createApi } from './http.js';

const token=process.env.STORE_API_TOKEN??'';
if(token.length<32)throw new Error('Set STORE_API_TOKEN to at least 32 random characters');
const port=Number(process.env.STORE_PORT??4318);
if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Invalid STORE_PORT');
const store=new Store(resolve(process.env.STORE_DATA_DIR??'data'));
let graph:Neo4jGraph|undefined;
if(process.env.NEO4J_URI){
  if(!process.env.NEO4J_PASSWORD)throw new Error('Set NEO4J_PASSWORD when NEO4J_URI is configured');
  graph=new Neo4jGraph(process.env.NEO4J_URI,process.env.NEO4J_USER??'neo4j',process.env.NEO4J_PASSWORD,process.env.NEO4J_DATABASE??'neo4j');
  try{await graph.initialize();}catch{console.error('Graph unavailable at startup; durable journal remains available and projections will retry.');}
}
const server=createApi(store,token,graph);
server.listen(port,process.env.STORE_HOST??'127.0.0.1',()=>console.error(`Research store listening on port ${port}`));
const timer=setInterval(()=>{if(graph)void store.projectPending(graph).catch(()=>console.error('Projection worker failed; pending work retained.'));},5000);
let closing=false;
async function shutdown(){
  if(closing)return;closing=true;clearInterval(timer);
  await new Promise<void>(resolve=>server.close(()=>resolve()));
  if(graph){await store.projectPending(graph).catch(()=>{});await graph.close();}
  store.close();
}
process.once('SIGINT',()=>void shutdown());process.once('SIGTERM',()=>void shutdown());
