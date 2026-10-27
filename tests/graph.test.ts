import { expect,it,vi } from 'vitest';
import { FindingSchema } from '../src/inputs.js';
const calls=vi.hoisted(()=>[] as {query:string;parameters:Record<string,unknown>}[]);
vi.mock('neo4j-driver',()=>({default:{auth:{basic:()=>({})},driver:()=>({
  verifyConnectivity:async()=>{},executeQuery:async()=>{},close:async()=>{},session:()=>({
    close:async()=>{},executeWrite:async(fn:(tx:{run:(query:string,parameters:Record<string,unknown>)=>Promise<void>})=>Promise<void>)=>fn({run:async(query,parameters)=>{calls.push({query,parameters});}}),
  }),
})}}));
import { Neo4jGraph } from '../src/graph.js';
it('projects an origin subject with the subject role',async()=>{
  const graph=new Neo4jGraph('bolt://localhost','test','test');
  try{
    await graph.apply('finding',FindingSchema.parse({idempotency_key:'subject',origins:[{id:'origin',status:'candidate',evidence_ids:[],root_form_id:'root',subject_form_id:'subject',original_variation_ids:[]}]}));
    expect(calls).toContainEqual({query:expect.stringContaining('REFERS_TO'),parameters:{from:'origins:origin',to:'forms:subject',role:'subject'}});
    expect(calls.some(call=>call.query.includes('ACCEPTED_RELATION'))).toBe(false);
  }finally{await graph.close();}
});
