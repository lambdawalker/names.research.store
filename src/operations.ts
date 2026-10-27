import { z } from 'zod';
import { CacheKeySchema,CacheWriteSchema,DocumentInputSchema,FindingSchema,FindFormsSchema,
  FragmentSchema,ReadDocumentSchema,TraverseSchema,collections,type Collection } from './inputs.js';
import { Store, StoreError } from './store.js';
import type { Neo4jGraph } from './graph.js';
const hash=z.string().regex(/^[a-f0-9]{64}$/);
export const operationSchemas={
  record_finding:FindingSchema,store_document:DocumentInputSchema,read_document:ReadDocumentSchema,
  create_fragment:FragmentSchema,get_fragment:z.strictObject({fragment_id:hash}),
  cache_search:CacheWriteSchema,get_cached_search:CacheKeySchema,prune_cache:z.strictObject({}),
  find_forms:FindFormsSchema,get_ancestry:TraverseSchema,get_descendants:TraverseSchema,
  get_status:z.strictObject({}),get_finding:z.strictObject({finding_id:hash}),
  get_entity:z.strictObject({collection:z.enum(collections),id:z.string().min(1).max(512)}),
  project_pending:z.strictObject({}),
};
export type OperationName=keyof typeof operationSchemas;
export function isOperationName(name:string):name is OperationName{return Object.hasOwn(operationSchemas,name);}
export async function operate(store:Store,name:OperationName,input:unknown,graph?:Neo4jGraph):Promise<unknown>{
  const data=operationSchemas[name].parse(input);
  const requireGraph=()=>{if(!graph)throw new StoreError(503,'Graph is not configured; finding admission and document/cache storage remain available');return graph;};
  switch(name){
    case 'record_finding':return store.recordFinding(data);
    case 'store_document':return store.storeDocument(data);
    case 'read_document':return store.readDocument(data);
    case 'create_fragment':return store.createFragment(data);
    case 'get_fragment':return store.getFragment((data as {fragment_id:string}).fragment_id);
    case 'cache_search':return store.cacheSearch(data);
    case 'get_cached_search':return store.getCachedSearch(data);
    case 'prune_cache':return store.pruneCache();
    case 'find_forms':return store.findForms(data);
    case 'get_ancestry':return requireGraph().traverse(data,'ancestry');
    case 'get_descendants':return requireGraph().traverse(data,'descendants');
    case 'get_status':return {...store.status(),graph_configured:!!graph};
    case 'get_finding':return store.findingReceipt((data as {finding_id:string}).finding_id);
    case 'get_entity':{const ref=data as {collection:Collection;id:string};return store.readEntity(ref.collection,ref.id);}
    case 'project_pending':return store.projectPending(requireGraph());
  }
}
