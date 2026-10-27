import neo4j, { type Driver } from 'neo4j-driver';
import { canonicalJson } from './documents.js';
import { collections, TraverseSchema, type Finding } from './inputs.js';
import type { GraphSink } from './store.js';

export class Neo4jGraph implements GraphSink {
  private driver: Driver;
  private initialized=false;
  constructor(uri: string, username: string, password: string, private database = 'neo4j') {
    this.driver=neo4j.driver(uri,neo4j.auth.basic(username,password),{maxTransactionRetryTime:5000});
  }
  async initialize() {
    if(this.initialized)return;
    await this.driver.verifyConnectivity();
    await this.driver.executeQuery('CREATE CONSTRAINT research_entity_key IF NOT EXISTS FOR (n:ResearchEntity) REQUIRE n.key IS UNIQUE',{}, {database:this.database});
    this.initialized=true;
  }
  async close() { await this.driver.close(); }
  async apply(id: string, finding: Finding) {
    await this.initialize();
    const session=this.driver.session({database:this.database});
    try {
      await session.executeWrite(async tx=>{
        for (const kind of collections) {
          for (const entity of finding[kind]) {
            const key=`${kind}:${entity.id}`;
            await tx.run('MERGE (n:ResearchEntity {key:$key}) SET n.kind=$kind,n.id=$id,n.body_json=$body',
              {key,kind,id:entity.id,body:canonicalJson(entity)});
            if (kind==='forms') await tx.run('MATCH (n:ResearchEntity {key:$key}) SET n:NameForm', {key});
            if (['origins','relationships','usages','notable_bearers','statistics'].includes(kind)) {
              await tx.run('MATCH (n:ResearchEntity {key:$key}) SET n:Claim,n.status=$status', {key,status:(entity as {status:string}).status});
            }
          }
        }
        const connect=async(from:string,to:string,role:string)=>{
          await tx.run('MATCH (a:ResearchEntity {key:$from}),(b:ResearchEntity {key:$to}) MERGE (a)-[:REFERS_TO {role:$role}]->(b)', {from,to,role});
        };
        for(const evidence of finding.evidence) await connect('evidence:'+evidence.id,'sources:'+evidence.source_id,'source');
        for(const kind of ['origins','relationships','usages','notable_bearers','statistics'] as const) {
          for(const claim of finding[kind]) {
            const key=`${kind}:${claim.id}`;
            for(const evidenceId of claim.evidence_ids) await connect(key,'evidence:'+evidenceId,'evidence');
            if('root_form_id' in claim) {
              await connect(key,'forms:'+claim.root_form_id,'root');
              for(const form of claim.original_variation_ids) await connect(key,'forms:'+form,'variation');
            }
            if('form_id' in claim) await connect(key,'forms:'+claim.form_id,'form');
            if('form_ids' in claim) for(const form of claim.form_ids) await connect(key,'forms:'+form,'form');
            if('from_form_id' in claim) {
              await connect(key,'forms:'+claim.from_form_id,'subject');
              await connect(key,'forms:'+claim.to_form_id,'antecedent');
              if(claim.status==='supported') await tx.run(
                'MATCH (a:ResearchEntity {key:$from}),(b:ResearchEntity {key:$to}) MERGE (a)-[r:ACCEPTED_RELATION {claim_key:$claim}]->(b) SET r.type=$type',
                {from:'forms:'+claim.from_form_id,to:'forms:'+claim.to_form_id,claim:key,type:claim.type});
            }
          }
        }
        await tx.run('MERGE (f:AppliedFinding {id:$id})',{id});
      },{timeout:10000});
    } finally { await session.close(); }
  }
  async traverse(input: unknown, direction: 'ancestry'|'descendants') {
    const {form_id,depth,limit}=TraverseSchema.parse(input);
    // Only derivation/borrowing edges establish ancestry. Counterpart, spelling
    // and transliteration edges remain queryable graph claims but not ancestors.
    const pattern=direction==='ancestry'?`(start)-[:ACCEPTED_RELATION*1..${depth}]->(other:NameForm)`:
      `(start)<-[:ACCEPTED_RELATION*1..${depth}]-(other:NameForm)`;
    const session=this.driver.session({database:this.database,defaultAccessMode:neo4j.session.READ});
    try {
      const result=await session.executeRead(tx=>tx.run(
        `MATCH (start:NameForm {key:$key}) MATCH p=${pattern}
         WHERE all(r IN relationships(p) WHERE r.type IN ['derived_from','borrowed_from','diminutive_of'])
         AND other<>start RETURN [n IN nodes(p)|n.body_json] AS forms,
         [r IN relationships(p)|r.claim_key] AS claims LIMIT $limit`,
        {key:'forms:'+form_id,limit:neo4j.int(limit)}),{timeout:3000});
      return {direction,depth,paths:result.records.map(record=>({
        forms:(record.get('forms') as string[]).map(body=>JSON.parse(body)),claim_keys:record.get('claims'),
      })),projection:'applied_only'};
    } finally { await session.close(); }
  }
}
