# Research storage service — approved architecture

## Purpose and scope

The user approved a dedicated repository with HTTP and MCP interfaces over graph
and SQL storage, and requested normalized Markdown evidence to keep the cache
light. The agent persists incremental findings, traces ancestry, expands descendants
and investigates borrowing. JSON is an interchange/report format, not the primary
application state. Source-client libraries and LLM orchestration remain separate.

## Approaches and selected design

SQLite alone simplifies installation but complicates relationship exploration.
A graph alone makes knowledge traversal natural but is less convenient for the
durable write journal and expiring cache. The approved approach combines them
behind one service. Implementation defaults: TypeScript/Node.js 24, Neo4j graph,
SQLite journal/cache and local content-addressed Markdown files. The HTTP and MCP
layers call the same operations; the MCP stdio adapter calls HTTP rather than
opening a second writer. No arbitrary Cypher, SQL, shell or remote-fetch tool.

## Ownership and consistency

SQL durably journals each finding and the pending graph projection in one
transaction. It also holds entity IDs and immutable validated write payloads to
check cross-finding references. The graph is the query projection for research
relationships. This explicitly makes the journal authoritative for recovery;
claiming two independently authoritative databases would create ambiguity.
Neo4j can be rebuilt by replaying the journal. Request acknowledgements mean
durable SQL acceptance, not immediate graph visibility. Return projection state.

Use idempotency keys with canonical request digests: repeat identical requests
return the same finding; a changed payload with the same key conflicts. Entity
IDs and contents are immutable in the initial release; corrections are additional
claims with new IDs. A future explicit revision API can add controlled review
transitions without overwriting evidence. The current release must not silently
replace existing entities. Projection is idempotent and atomic per finding.
One service process owns SQLite and the projection worker in this release.

## Research model

Forms retain spelling, language/stage, script, name kind, origin sense and
reconstruction status. Canonical identity preserves diacritics and NFC. Claims
are first-class nodes with status, interpretation and links to evidence; usage
does not imply borrowing. Accepted relationship traversals use only supported
claims. Cycles are permitted; traversal depth and result count are bounded.
Canonical contracts originated during milestone 1 in the orchestrator workspace
and now belong in this repository. They remain independent of a database driver.

## Markdown evidence and retention

Convert HTML to Markdown deterministically, removing scripts/styles/navigation
containers. Preserve words, native scripts, headings, links and table content;
do not let an LLM rewrite or summarize source material. Plain text and Markdown
remain text. JSON is rendered in a fenced block to preserve structured values.
Conversion is lossy: a normalized document is not an exact original-source quote.

Each source document stores provider/source ID, exact locator, retrieval/revision
metadata, UTF-8 input SHA-256, Markdown SHA-256, original/normalized sizes and a
converter version. Store one .md file per normalized-content hash, with separate
metadata rows for different sources or revisions. Evidence fragments identify the
document, normalized text offsets and fragment hash; offsets are UTF-16 code units
as used by JavaScript, not original HTML offsets. Original source pointers remain
available. Content and quotations are untrusted data, never tool instructions.

Raw source bodies are not retained by default. Initial release supports normalized
Markdown only and metadata-only retention, rather than implementing a raw archive.
Caller must explicitly declare permitted retention; metadata-only never writes a
body. This is a policy assertion from trusted source adapters, not a license
determination performed by the service. Markdown conversion does not change rights.
Public source-data exports and automated rights assessment remain out of scope.

Search cache keys include provider, operation, complete query parameters, language,
filters, pagination and a nonsecret credential/account scope where results differ.
Objects are canonicalized before hashing. Every cache entry has a TTL, maximum
size and original retrieval time. Expired/empty results are distinct; evidence
documents are retained independently of search-result expiration. Search errors
should not be cached as successful empty results. A prune operation removes only
expired search entries; it does not delete cited documents.

## API, MCP and deployment

One POST /v1/operations/:name endpoint family exposes validated operations for
record_finding, find_forms, graph ancestry/descendants, storing/reading documents,
creating/reading fragments, cache write/read/prune, journal reads, status and a
bounded projection retry. Graph credentials are service-owned. API authentication
uses a configured bearer token, binding localhost by default. This is a local,
single-user service, not a multi-tenant system. Use HTTPS/reverse-proxy controls
before network exposure. HTTP request/response and MCP tool outputs are bounded.

MCP uses the official TypeScript SDK with stdio; stdout is protocol only. It
holds only an API token and URL, not database credentials. Source API credentials
remain with the source adapter/vault, not the graph or LLM. Local .env/data files
are ignored by git. Provide Docker Compose for Neo4j without embedding passwords.

## Explicit limits

No source scraping, API connectors, LLM orchestration, public release exports,
distributed workers, multi-user authorization, model selection or production
hosting in this milestone. Live Neo4j verification requires a reachable instance;
fake sinks test recovery semantics but are not a live-database test.
