# names.research.store

TypeScript research storage service with an authenticated HTTP API and a stdio
MCP adapter. Agents submit incremental, evidenced findings; they do not need to
construct a complete name-family JSON document or run database commands.

## Storage

| Component | Purpose |
|---|---|
| Neo4j | Queryable graph of forms, typed claims and evidence; supported-only ancestry/descendant traversals |
| SQLite | Durable immutable finding journal, reference/identity index, graph outbox, document/fragment metadata and TTL search cache |
| Content-addressed `.md` files | Normalized source text; identical normalized bodies share a file while retaining separate provenance |

SQL admission and graph application are deliberately separate. `record_finding`
returns `projection: pending` after the finding and outbox row commit atomically.
The worker retries graph failures in order; `get_finding` reports `applied` after
projection. A graph outage does not discard accepted research. The SQL journal
is the recovery authority; Neo4j is its graph-query projection.

This first release uses **one service process per data directory**. The MCP
adapter talks to HTTP rather than opening another database writer. No source
connectors, credential vault, local LLM or DeepSeek runner are bundled yet.

## Local setup

Requires Node.js 24+ and a reachable Neo4j instance. Docker Compose is the supplied
local Neo4j option; it is not required if you already run Neo4j.

```sh
npm ci
npm test
npm run typecheck
```

Copy `.env.example` to `.env`. On PowerShell use `Copy-Item .env.example .env`;
on Linux/macOS use `cp .env.example .env`. Generate two independent secrets:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Run that command twice, filling `STORE_API_TOKEN` and `NEO4J_PASSWORD` respectively
in `.env`. The password must match your existing database if not using Compose.
Then:

```sh
docker compose up -d
npm run build
npm start
```

The API defaults to `http://127.0.0.1:4318`. SQLite and normalized documents live
in `data/`, which is ignored by git. Compose binds Neo4j ports to loopback and
uses a persistent volume. Changing `.env` does not reset an existing Neo4j password.
The service needs no GPU. It can start in SQL-only mode with `NEO4J_URI` unset;
graph queries then return 503 and pending findings wait for a configured graph.

This is a local single-user API. Use HTTPS and appropriate deployment access
controls before network exposure; no multi-user authorization is implemented.

## HTTP operations

`GET /health` checks process liveness. All research operations use:

```text
POST /v1/operations/<operation_name>
Authorization: Bearer <STORE_API_TOKEN>
Content-Type: application/json
```

| Operation | Input |
|---|---|
| `record_finding` | `idempotency_key` and any nonempty selection of forms, sources, evidence, origins, relationships, usages, notable_bearers, statistics |
| `find_forms` | query, optional language, limit (1–100) |
| `get_ancestry`, `get_descendants` | form_id, depth (1–6), limit (1–100) |
| `get_finding` | finding_id from an admission receipt |
| `get_entity` | collection and id; follows claim/evidence/source IDs from graph paths |
| `store_document` | source metadata, locator, content, format, retention |
| `read_document` | document_id, offset and limit (1–16000 UTF-16 units) |
| `create_fragment` | document_id, start, end (at most 16000 UTF-16 units) |
| `get_fragment` | fragment_id |
| `cache_search` | key, value, ttl_seconds (1–604800) |
| `get_cached_search` | provider, operation, scope and parameters |
| `prune_cache` | `{}`; removes expired cache entries only |
| `get_status` | `{}`; returns finding/document counts, pending count and graph configuration state |
| `project_pending` | `{}`; retries a bounded batch of pending findings |

Search cache key example:

```json
{
  "provider": "wiktionary",
  "operation": "search",
  "scope": "public",
  "parameters": {"name": "John", "language": "en", "page": 1}
}
```

All result-affecting filters/pagination and a nonsecret account scope belong in
the key. Do not put tokens in it. Canonical object ordering prevents redundant
cache entries. Cache values are limited to 64 KiB and should contain search
metadata/document references, not duplicated article bodies. An empty result is
different from an expired/missing entry. Source errors must not be cached as empty
successes. TTL expiration never removes retained evidence documents.

Request bodies are limited to 2 MiB, finding payloads to 512 KiB, and responses to
128 KiB. Submitted arrays allow 200 entities per collection; dependency hydration
allows up to 2000 referenced forms/sources/evidence and 4 MiB total. Split findings
that exceed these bounds. Reduce page/depth/limit when a read exceeds the response cap. Cross-finding
references are resolved from the durable index. Existing entity IDs are immutable;
use a new claim ID for an additional interpretation or correction. A controlled
review/revision operation is a future milestone. Changed payloads with the same
idempotency key return 409. Calling the same finding again returns its original ID.

## Evidence as Markdown

`store_document` accepts `html`, `markdown`, `text` or `json`, with an explicit
`retention` of `allowed` or `metadata_only`. HTML is converted deterministically,
removing executable/navigation containers. Text is not rewritten by an LLM;
native scripts and diacritics remain. JSON is preserved in a fenced block.

Metadata records the UTF-8 input hash, normalized Markdown hash, conversion
version, byte sizes, source and original locator. Retained bodies are deduplicated
as `data/documents/<markdown-hash>.md`. Raw HTML/responses are not stored. Markdown
is a lossy representation: its offsets/quotations are normalized-document offsets,
not exact original HTML positions. Keep original locators/revisions for checking.

Fragments retain their document ID, UTF-16 start/end and SHA-256. Evidence may
reference `document_id` and `fragment_id`; admission verifies both exist and
belong to the same source. A source-specific passage/note is still required.
Document/source metadata can be cached before a finding references it; a later
finding carries referenced source metadata into the graph projection.

`metadata_only` stores hashes and provenance, not content, and cannot yield text
fragments. A trusted adapter must decide whether storage is permitted. Conversion
to Markdown does not change the source's license or make redistribution legal.
No public-data export clearance is implemented. Treat all Markdown/links as
untrusted input and sanitize rendering if you build a UI.

## MCP

Configure your MCP host to run the compiled adapter with only the API URL and
token. It does not need Neo4j credentials or filesystem access to the store:

```json
{
  "mcpServers": {
    "name-research-store": {
      "command": "node",
      "args": ["/absolute/path/names.research.store/dist/mcp.js"],
      "env": {
        "STORE_API_URL": "http://127.0.0.1:4318",
        "STORE_API_TOKEN": "<your configured API token>"
      }
    }
  }
}
```

The MCP process exposes the same validated operations. Remote API URLs require
HTTPS; redirects are refused. Keep configured credentials in your host's secret
storage. `npm run mcp` is convenient locally but a direct `node` command keeps
package-manager banners off protocol stdout.

## Graph, model and tests

Claims and evidence are nodes; supported relation projections connect forms for
traversal. Counterpart/transliteration/spelling relations do not become ancestry.
Cycles are allowed; query depth, result limit and timeout are bounded. Journal
queries may see newly admitted forms before a graph query sees their relationships.
SQL and Neo4j are not covered by one distributed transaction.

The exported Zod contracts and the candidate-only user draft remain available:

```sh
npm run validate -- examples/juan-family.draft.json
node dist/cli/summarize.js examples/juan-family.draft.json --include-unverified
```

The fixture is not verified etymological research. Schema validation cannot
prove a source supports a claim or that sources are independent.

`npm test` includes real temporary SQLite databases, HTTP requests, and an MCP
client/server handshake. The live Neo4j test is opt-in: set `TEST_NEO4J_URI`,
`TEST_NEO4J_PASSWORD` and optionally `TEST_NEO4J_USER`/`TEST_NEO4J_DATABASE`, then run
`npm test -- tests/graph.live.test.ts`. Use a dedicated test database; the test
adds synthetic nodes with unique prefixes and does not delete them.

See [the design](docs/superpowers/specs/2026-10-26-storage-service-design.md) and
[implementation plan](docs/superpowers/plans/2026-10-26-storage-service.md).

Software: MIT. Source documents and datasets retain their own licensing terms.
