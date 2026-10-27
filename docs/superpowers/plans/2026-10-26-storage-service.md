# Research Store Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans for this approved service milestone.

**Goal:** Persist incremental evidenced findings and compact source documents behind shared HTTP/MCP operations.

**Architecture:** SQLite journals findings and an outbox atomically; Neo4j provides the research graph projection. Markdown files are content-addressed. The stdio MCP adapter uses the HTTP API so it does not open another SQL writer.

**Tech Stack:** Node.js 24, TypeScript, Zod, node:sqlite, neo4j-driver, Turndown, official MCP TypeScript SDK, Vitest.

**Spec:** ../specs/2026-10-26-storage-service-design.md

## Global constraints

- One service process owns SQLite and the projection worker in this release.
- Raw source bodies are not retained by default.
- No arbitrary Cypher, SQL, shell or remote-fetch tool.
- Markdown conversion does not change rights.

## Review focus

- Invalid forms must return structured validation failure, not throw from safeParse.
- HTML removal must retain native scripts and source wording; empty or oversized bodies fail clearly.
- Database rollback, reopen and repeated idempotency keys must not duplicate findings.
- Graph failure after SQL commit must leave retryable work, with no false claim of graph visibility.
- HTTP/MCP paths must share validation, authentication and output limits.

### Task 1: Contracts and Markdown normalization

Files: src/domain/*, src/documents.ts, tests/domain.test.ts, tests/documents.test.ts.

- [x] Reproduce the known nested safeParse exception with invalid form fields; fix identity validation without discarding nested error paths.
- [x] Test and implement normalizeDocument(content, format): hashes, converter version, byte limits, deterministic HTML/plain/JSON/Markdown conversion.
- [x] Preserve the user draft as candidate-only research data; run build/typecheck/tests.

### Task 2: SQL journal, cache and document persistence

Files: src/store.ts, src/inputs.ts, tests/store.test.ts.

- [x] Test atomic finding admission, duplicate/conflicting keys, references across findings, immutable entities, reopen and rollback.
- [x] Implement Store.recordFinding(input) and indexed entity identity/reference checks with an atomic pending outbox row.
- [x] Test/implement content-addressed Markdown, metadata-only retention, bounded fragments and expiring scoped search cache; prune never deletes evidence.

### Task 3: Graph projection and bounded traversal

Files: src/graph.ts, tests/projection.test.ts, tests/graph.live.test.ts.

- [x] Test sink failure/retry and apply-success/crash-before-ack replay; implement Store.projectPending(sink).
- [x] Implement Neo4j uniqueness constraints, parameterized atomic entity/claim projection and supported-only bounded ancestry/descendant queries.
- [x] Add opt-in live test against an explicitly configured Neo4j database. Local live test is skipped because no Neo4j/Docker is available; CI is configured to run it.

### Task 4: HTTP and MCP service

Files: src/operations.ts, src/http.ts, src/main.ts, src/mcp.ts, tests/http.test.ts, tests/mcp.test.ts.

- [x] Test unauthorized requests, malformed/oversized input, idempotent operations, bounded reads and response errors.
- [x] Implement shared validated operations, loopback HTTP server and a stdio MCP adapter that calls HTTP.
- [x] Exercise MCP through the official in-memory client/server transport; build and typecheck all entry points.

### Task 5: Handoff

Files: README.md, compose.yaml, .env.example, LICENSE, CI and journal/recovery documentation.

- [x] Provide local setup, source-retention semantics, curl/MCP examples and opt-in live Neo4j test instructions.
- [ ] Publish the verified review fixes as a branch/PR and update the orchestrator roadmap.
