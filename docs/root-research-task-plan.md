# Root research persistence plan

Add an optional origin subject reference without changing legacy records. Validate and hydrate that reference, then project it using the existing REFERS_TO relationship.

Persist root task snapshots and immutable write receipts in additive SQLite tables. Serialize compare-and-swap admission with BEGIN IMMEDIATE; check global write replay before revision checks, validate finding references before updating, and keep tasks outside the graph outbox. Expose the same schemas through HTTP and MCP.

Verification: write failing tests for reference admission, CAS/replay/restart, immutable fields, payload limits, and API/tool discovery; implement the minimal changes; run the complete suite and typecheck. Commit locally only.
