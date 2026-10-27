# Root research tasks

The migration is additive and runs when Store opens: `research_tasks` stores the latest receipt per task ID, and `task_writes` stores globally unique write IDs, canonical request digests, and original receipts. Existing entity, finding, and outbox tables remain readable. Back up the SQLite database using a SQLite-aware backup while the service is running, or stop the service before copying it with its WAL.

Origin claims accept an optional `subject_form_id`. It identifies the researched name, while `root_form_id` identifies the proposed root. Both must reference an admitted form or a form in the same finding. Legacy origins without a subject remain valid. The graph projects an origin's subject using `REFERS_TO {role:'subject'}`; it does not manufacture an accepted ancestry edge.

`get_form_by_identity` accepts a complete FormSchema value and returns the existing complete form or `null`. Identity ignores the proposed ID and metadata such as transliterations. Resolve proposed forms before journal admission so legacy IDs and immutable metadata remain intact; unlike prefix search, this operation uses the unique canonical identity index.

HTTP operations use authenticated `POST /v1/operations/{name}`. MCP exposes the same names and input schemas. `get_research_task` and `get_form_by_identity` are annotated read-only.

`save_research_task` accepts:

```json
{
  "task": {
    "id": "root-john-en",
    "input": {"name": "John", "language": "en"},
    "phase": "root",
    "status": "pending",
    "checkpoint": {"pending_finding": null},
    "finding_ids": [],
    "session_ids": [],
    "stats": {"sessions": 0, "model_calls": 0, "tool_calls": 0}
  },
  "expected_revision": 0,
  "write_id": "root-john-en-write-1"
}
```

The result is `{task, revision, updated_at}` with an ISO timestamp. New tasks require revision 0 and return revision 1. Updates must match the current revision and increment it once. `get_research_task` accepts `{task_id}` and returns the current receipt or `null`. The task's input, ID, and root phase are immutable. Status is one of `pending`, `running`, `review_required`, `unresolved`, `budget_stopped`, or `failed`. Stats are nonnegative integers. Name and language are limited to 256 and 128 characters respectively; optional note is limited to 2048. Finding IDs must be SHA-256 journal IDs; finding and session arrays each permit 100 entries.

A task request is limited to 64 KiB of canonical UTF-8 JSON and its JSON checkpoint to 32 KiB. Exceeding these byte limits returns HTTP 413. Invalid schemas and missing finding references return 400. Revision conflicts, changed immutable inputs, or reuse of a write ID for a different canonical request return 409. The digest includes `expected_revision`. Repeating an identical request returns its original receipt even after later updates or process restart. Failed writes do not consume their write IDs. Updates and write receipts commit atomically under SQLite's immediate transaction lock, including across service connections.

Task metadata never enters the graph projection outbox. Finding and task saves are separate writes: persist the pending finding and its stable idempotency key in `checkpoint` **before** calling `record_finding`; after admission, append the returned finding ID and clear the pending checkpoint through CAS. On restart, replay the same pending finding before advancing. This ordering allows crash recovery without claiming a finding was stored before admission succeeded.

The package `prepare` hook compiles TypeScript for Git dependency installation. No arbitrary SQL or Cypher operation is exposed.
