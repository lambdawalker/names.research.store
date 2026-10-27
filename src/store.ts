import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ResearchSchema } from './domain/research.js';
import { FormSchema, formIdentity, normalizeSearchKey } from './domain/forms.js';
import { canonicalJson, normalizeDocument, sha256 } from './documents.js';
import { CacheKeySchema, CacheWriteSchema, DocumentInputSchema, FindingSchema, FindFormsSchema,
  FragmentSchema, ReadDocumentSchema, ProjectionFindingSchema, SaveResearchTaskSchema, GetResearchTaskSchema, type ResearchTaskReceipt, collections, type Collection, type Finding } from './inputs.js';

export class StoreError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export interface GraphSink { apply(findingId: string, finding: Finding): Promise<void> }
type Entity = { id: string; [key: string]: unknown };
type DocumentRow = { id: string; metadata: string; markdown_hash: string; retained: number };

export class Store {
  private db: DatabaseSync;
  private projection: Promise<{ applied: number; failed: number }> | undefined;
  constructor(private directory: string, private clock: () => number = Date.now) {
    mkdirSync(join(directory, 'documents'), { recursive: true });
    this.db = new DatabaseSync(join(directory, 'store.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS entities(kind TEXT NOT NULL,id TEXT NOT NULL,body TEXT NOT NULL,
        identity TEXT UNIQUE,search_key TEXT,language TEXT,PRIMARY KEY(kind,id));
      CREATE UNIQUE INDEX IF NOT EXISTS claim_id ON entities(id) WHERE kind IN
        ('origins','relationships','usages','notable_bearers','statistics');
      CREATE INDEX IF NOT EXISTS form_search ON entities(kind,search_key,language);
      CREATE TABLE IF NOT EXISTS findings(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,
        request_key TEXT UNIQUE NOT NULL,digest TEXT NOT NULL,payload TEXT NOT NULL,created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS outbox(finding_id TEXT PRIMARY KEY,state TEXT NOT NULL DEFAULT 'pending');
      CREATE TABLE IF NOT EXISTS documents(id TEXT PRIMARY KEY,metadata TEXT NOT NULL,markdown_hash TEXT NOT NULL,retained INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS fragments(id TEXT PRIMARY KEY,document_id TEXT NOT NULL,start INTEGER NOT NULL,end INTEGER NOT NULL,sha256 TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS cache(key TEXT PRIMARY KEY,value TEXT NOT NULL,created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS cache_expiry ON cache(expires_at);
      CREATE TABLE IF NOT EXISTS research_tasks(id TEXT PRIMARY KEY,receipt TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS task_writes(write_id TEXT PRIMARY KEY,digest TEXT NOT NULL,receipt TEXT NOT NULL);`);
  }
  close() { this.db.close(); }
  private transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  private getEntity(kind: Collection, id: string): Entity | undefined {
    const row = this.db.prepare('SELECT body FROM entities WHERE kind=? AND id=?').get(kind, id) as {body:string}|undefined;
    return row ? JSON.parse(row.body) : undefined;
  }
  readEntity(kind:Collection,id:string){
    if(!collections.includes(kind))throw new StoreError(400,'Invalid entity collection');
    const entity=this.getEntity(kind,id);
    if(!entity)throw new StoreError(404,'Entity not found');
    return {collection:kind,entity,consistency:'durable_journal'};
  }
  private insertEntity(kind: Collection, entity: Entity) {
    const body = canonicalJson(entity);
    const existing = this.getEntity(kind, entity.id);
    if (existing) {
      if (canonicalJson(existing) !== body) throw new StoreError(409, `Entity ${kind}/${entity.id} is immutable; use a new ID`);
      return;
    }
    const form = kind === 'forms' ? entity as unknown as Finding['forms'][number] : undefined;
    const identity = form ? formIdentity(form) : null;
    if (identity && this.db.prepare('SELECT id FROM entities WHERE identity=?').get(identity)) {
      throw new StoreError(409, 'Canonical form identity already exists under another ID');
    }
    if (['origins','relationships','usages','notable_bearers','statistics'].includes(kind) &&
        this.db.prepare("SELECT id FROM entities WHERE id=? AND kind IN ('origins','relationships','usages','notable_bearers','statistics')").get(entity.id)) {
      throw new StoreError(409, 'Claim ID already exists in another collection');
    }
    this.db.prepare('INSERT INTO entities(kind,id,body,identity,search_key,language) VALUES(?,?,?,?,?,?)')
      .run(kind, entity.id, body, identity, form ? normalizeSearchKey(form.spelling) : null, form?.language.code ?? null);
  }
  recordFinding(input: unknown) {
    const finding = FindingSchema.parse(input);
    const payload = canonicalJson(finding);
    if (Buffer.byteLength(payload) > 524288) throw new StoreError(413, 'Finding exceeds 512 KiB');
    const digest = sha256(payload);
    return this.transaction(() => {
      const existing = this.db.prepare('SELECT id,digest FROM findings WHERE request_key=?').get(finding.idempotency_key) as {id:string;digest:string}|undefined;
      if (existing) {
        if (existing.digest !== digest) throw new StoreError(409, 'Idempotency key/payload conflict');
        return this.findingReceipt(existing.id);
      }
      const context = Object.fromEntries(collections.map(key => [key, [...finding[key]]])) as unknown as Record<Collection, Entity[]>;
      const include = (kind: Collection, id: string) => {
        if (context[kind].some(entity => entity.id === id)) return;
        const existingEntity = this.getEntity(kind, id);
        if (existingEntity) context[kind].push(existingEntity);
      };
      for (const key of ['origins','relationships','usages','notable_bearers','statistics'] as const) {
        for (const claim of finding[key]) {
          claim.evidence_ids.forEach(id => include('evidence', id));
          if ('root_form_id' in claim) {
            if (claim.subject_form_id) include('forms', claim.subject_form_id);
            include('forms', claim.root_form_id); claim.original_variation_ids.forEach(id => include('forms', id));
          }
          if ('from_form_id' in claim) { include('forms', claim.from_form_id); include('forms', claim.to_form_id); }
          if ('form_id' in claim) include('forms', claim.form_id);
          if ('form_ids' in claim) claim.form_ids.forEach(id => include('forms', id));
        }
      }
      for (const evidence of context.evidence) include('sources', evidence.source_id as string);
      for(const evidence of finding.evidence){
        if(evidence.document_id){
          const row=this.db.prepare('SELECT metadata FROM documents WHERE id=?').get(evidence.document_id) as {metadata:string}|undefined;
          if(!row||JSON.parse(row.metadata).source_id!==evidence.source_id)throw new StoreError(400,'Evidence document is missing or belongs to another source');
          if(evidence.fragment_id){
            const fragment=this.db.prepare('SELECT document_id FROM fragments WHERE id=?').get(evidence.fragment_id) as {document_id:string}|undefined;
            if(fragment?.document_id!==evidence.document_id)throw new StoreError(400,'Evidence fragment is missing or belongs to another document');
          }
        }
      }
      ResearchSchema.parse({schema_version:'1.0.0',record_id:'finding',input:{name:'incremental finding'},
        coverage:{status:'in_progress',searched_sources:[],notes:[]},...context});
      for (const key of collections) for (const entity of finding[key]) this.insertEntity(key, entity);
      const id = sha256(finding.idempotency_key);
      const projectionPayload=canonicalJson(ProjectionFindingSchema.parse({...finding,...context}));
      if(Buffer.byteLength(projectionPayload)>4194304)throw new StoreError(413,'Hydrated finding exceeds 4 MiB; split the finding');
      this.db.prepare('INSERT INTO findings(id,request_key,digest,payload,created_at) VALUES(?,?,?,?,?)')
        .run(id,finding.idempotency_key,digest,projectionPayload,this.clock());
      this.db.prepare('INSERT INTO outbox(finding_id) VALUES(?)').run(id);
      return this.findingReceipt(id);
    });
  }
  saveResearchTask(input: unknown): ResearchTaskReceipt {
    const data = SaveResearchTaskSchema.parse(input);
    const payload = canonicalJson(data);
    if (Buffer.byteLength(payload) > 65536) throw new StoreError(413, 'Task request exceeds 64 KiB');
    if (Buffer.byteLength(canonicalJson(data.task.checkpoint)) > 32768) throw new StoreError(413, 'Task checkpoint exceeds 32 KiB');
    const digest = sha256(payload);
    return this.transaction(() => {
      const write = this.db.prepare('SELECT digest,receipt FROM task_writes WHERE write_id=?').get(data.write_id) as {digest:string;receipt:string}|undefined;
      if (write) {
        if (write.digest !== digest) throw new StoreError(409, 'Write ID/payload conflict');
        return JSON.parse(write.receipt) as ResearchTaskReceipt;
      }
      const existing = this.getResearchTask({task_id:data.task.id});
      if ((existing?.revision ?? 0) !== data.expected_revision) throw new StoreError(409, 'Task revision conflict');
      if (existing && (canonicalJson(existing.task.input) !== canonicalJson(data.task.input) || existing.task.phase !== data.task.phase || existing.task.id !== data.task.id)) {
        throw new StoreError(409, 'Task input, id and phase are immutable');
      }
      for (const id of data.task.finding_ids) {
        if (!this.db.prepare('SELECT id FROM findings WHERE id=?').get(id)) throw new StoreError(400, 'Task finding does not exist in the journal: ' + id);
      }
      const receipt: ResearchTaskReceipt = {task:data.task,revision:data.expected_revision + 1,updated_at:new Date(this.clock()).toISOString()};
      const body = canonicalJson(receipt);
      this.db.prepare('INSERT INTO research_tasks(id,receipt) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET receipt=excluded.receipt').run(data.task.id,body);
      this.db.prepare('INSERT INTO task_writes(write_id,digest,receipt) VALUES(?,?,?)').run(data.write_id,digest,body);
      return receipt;
    });
  }
  getResearchTask(input: unknown): ResearchTaskReceipt | null {
    const {task_id} = GetResearchTaskSchema.parse(input);
    const row = this.db.prepare('SELECT receipt FROM research_tasks WHERE id=?').get(task_id) as {receipt:string}|undefined;
    return row ? JSON.parse(row.receipt) as ResearchTaskReceipt : null;
  }
  findingReceipt(id: string) {
    const row = this.db.prepare('SELECT state FROM outbox WHERE finding_id=?').get(id) as {state:string}|undefined;
    if (!row) throw new StoreError(404, 'Finding not found');
    return {finding_id:id,projection:row.state};
  }
  status() {
    const count = (table: string) => Number((this.db.prepare(`SELECT count(*) AS count FROM ${table}`).get() as {count:number}).count);
    return {findings:count('findings'),documents:count('documents'),
      pending:Number((this.db.prepare("SELECT count(*) AS count FROM outbox WHERE state='pending'").get() as {count:number}).count)};
  }
  getFormByIdentity(input: unknown) {
    const identity = formIdentity(FormSchema.parse(input));
    const row = this.db.prepare("SELECT body FROM entities WHERE kind='forms' AND identity=?").get(identity) as {body:string}|undefined;
    return row ? FormSchema.parse(JSON.parse(row.body)) : null;
  }
  findForms(input: unknown) {
    const {query,language,limit}=FindFormsSchema.parse(input);
    const prefix=normalizeSearchKey(query).replace(/[!%_]/g, '!$&')+'%';
    return (this.db.prepare("SELECT body FROM entities WHERE kind='forms' AND search_key LIKE ? ESCAPE '!' AND (? IS NULL OR language=?) ORDER BY id LIMIT ?")
      .all(prefix,language??null,language??null,limit) as {body:string}[]).map(row=>JSON.parse(row.body));
  }
  storeDocument(input: unknown) {
    const data=DocumentInputSchema.parse(input);
    const normalized=normalizeDocument(data.content,data.format);
    const id=sha256(canonicalJson({source_id:data.source.id,locator:data.locator,raw_hash:normalized.raw_sha256,
      format:data.format,markdown_hash:normalized.markdown_sha256,converter:normalized.converter,retention:data.retention}));
    const {markdown,...hashes}=normalized;
    const metadata={document_id:id,source_id:data.source.id,locator:data.locator,format:data.format,
      retention:data.retention,...hashes};
    if (data.retention==='allowed') {
      try { writeFileSync(join(this.directory,'documents',normalized.markdown_sha256+'.md'),markdown,{flag:'wx',mode:0o600}); }
      catch(error) { if ((error as NodeJS.ErrnoException).code!=='EEXIST') throw error; }
    }
    this.transaction(()=>{
      // Source nodes enter the graph through a journaled finding as well.
      // A document may reference source metadata before that finding is admitted.
      this.insertEntity('sources',data.source);
      this.db.prepare('INSERT OR IGNORE INTO documents(id,metadata,markdown_hash,retained) VALUES(?,?,?,?)')
        .run(id,canonicalJson(metadata),normalized.markdown_sha256,data.retention==='allowed'?1:0);
    });
    const stored=this.db.prepare('SELECT metadata FROM documents WHERE id=?').get(id) as {metadata:string};
    if(stored.metadata!==canonicalJson(metadata))throw new StoreError(409,'Document identity/metadata conflict');
    return metadata;
  }
  readDocument(input: unknown) {
    const data=ReadDocumentSchema.parse(input);
    const row=this.db.prepare('SELECT * FROM documents WHERE id=?').get(data.document_id) as DocumentRow|undefined;
    if (!row) throw new StoreError(404,'Document not found');
    if (!row.retained) throw new StoreError(409,'Document body was not retained');
    const body=readFileSync(join(this.directory,'documents',row.markdown_hash+'.md'),'utf8');
    if (sha256(body)!==row.markdown_hash) throw new StoreError(500,'Stored document checksum mismatch');
    return {metadata:JSON.parse(row.metadata),offset:data.offset,text:body.slice(data.offset,data.offset+data.limit),
      next_offset:data.offset+data.limit<body.length?data.offset+data.limit:null,total_units:body.length};
  }
  createFragment(input: unknown) {
    const {document_id,start,end}=FragmentSchema.parse(input);
    const document=this.readDocument({document_id,offset:start,limit:end-start});
    if (end>document.total_units) throw new StoreError(400,'Fragment is outside the normalized document');
    const hash=sha256(document.text),id=sha256(canonicalJson({document_id,start,end,hash}));
    this.db.prepare('INSERT OR IGNORE INTO fragments VALUES(?,?,?,?,?)').run(id,document_id,start,end,hash);
    return {fragment_id:id,document_id,start,end,sha256:hash,text:document.text};
  }
  getFragment(id: string) {
    if (!/^[a-f0-9]{64}$/.test(id)) throw new StoreError(400,'Invalid fragment ID');
    const row=this.db.prepare('SELECT * FROM fragments WHERE id=?').get(id) as {document_id:string;start:number;end:number;sha256:string}|undefined;
    if (!row) throw new StoreError(404,'Fragment not found');
    const document=this.readDocument({document_id:row.document_id,offset:row.start,limit:row.end-row.start});
    if (sha256(document.text)!==row.sha256) throw new StoreError(500,'Fragment checksum mismatch');
    return {fragment_id:id,...row,text:document.text};
  }
  cacheSearch(input: unknown) {
    const data=CacheWriteSchema.parse(input),key=canonicalJson(data.key),body=canonicalJson(data.value);
    if (Buffer.byteLength(body)>65536 || Buffer.byteLength(key)>8192) throw new StoreError(413,'Cache payload or key is too large');
    const now=this.clock();
    this.db.prepare('INSERT INTO cache VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,created_at=excluded.created_at,expires_at=excluded.expires_at')
      .run(sha256(key),body,now,now+data.ttl_seconds*1000);
    return {cached:true,expires_at:now+data.ttl_seconds*1000};
  }
  getCachedSearch(input: unknown) {
    const key=canonicalJson(CacheKeySchema.parse(input));
    if (Buffer.byteLength(key)>8192) throw new StoreError(413,'Cache key is too large');
    const row=this.db.prepare('SELECT value,created_at,expires_at FROM cache WHERE key=? AND expires_at>?')
      .get(sha256(key),this.clock()) as {value:string;created_at:number;expires_at:number}|undefined;
    return row?{value:JSON.parse(row.value),retrieved_at:row.created_at,expires_at:row.expires_at}:null;
  }
  pruneCache() { return {deleted:Number(this.db.prepare('DELETE FROM cache WHERE expires_at<=?').run(this.clock()).changes)}; }
  projectPending(sink: GraphSink) {
    if (this.projection) return this.projection;
    this.projection=this.drain(sink).finally(()=>{this.projection=undefined;});
    return this.projection;
  }
  private async drain(sink: GraphSink) {
    const rows=this.db.prepare("SELECT findings.id,payload FROM findings JOIN outbox ON findings.id=outbox.finding_id WHERE state='pending' ORDER BY seq LIMIT 50")
      .all() as {id:string;payload:string}[];
    let applied=0,failed=0;
    for (const row of rows) {
      try { await sink.apply(row.id,ProjectionFindingSchema.parse(JSON.parse(row.payload)));
        this.db.prepare("UPDATE outbox SET state='applied' WHERE finding_id=?").run(row.id); applied++;
      } catch { failed++; break; } // Preserve finding order and do not leak driver credentials.
    }
    return {applied,failed};
  }
}
