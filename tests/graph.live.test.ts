import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {Neo4jGraph} from '../src/graph.js';

it.skipIf(!process.env.TEST_NEO4J_URI)('projects and traverses a finding against a configured real Neo4j',async()=>{
  const graph=new Neo4jGraph(process.env.TEST_NEO4J_URI!,process.env.TEST_NEO4J_USER??'neo4j',process.env.TEST_NEO4J_PASSWORD!,process.env.TEST_NEO4J_DATABASE??'neo4j');
  const prefix='test-'+randomUUID();
  const form=(id:string,spelling:string)=>({id,spelling,language:{code:'en',name:'English'},script:'Latn',kind:'given_name' as const,reconstructed:false,transliterations:[]});
  const finding={idempotency_key:prefix,forms:[form(prefix+'-a','Test A'),form(prefix+'-b','Test B')],
    sources:[{id:prefix+'-s',provider:'synthetic',upstream_source:'synthetic',retrieved_at:'2026-10-26T00:00:00Z',public_reuse:'unknown' as const}],
    evidence:[{id:prefix+'-e',source_id:prefix+'-s',locator:'test:only',note:'Synthetic live test'}],
    relationships:[{id:prefix+'-r',from_form_id:prefix+'-a',to_form_id:prefix+'-b',type:'derived_from' as const,status:'supported' as const,evidence_ids:[prefix+'-e']}],
    origins:[],usages:[],notable_bearers:[],statistics:[]};
  try{await graph.initialize();await graph.apply(prefix,finding);await graph.apply(prefix,finding);
    const result=await graph.traverse({form_id:prefix+'-a'},'ancestry');expect(result.paths).toHaveLength(1);
  }finally{await graph.close();}
},30000);
