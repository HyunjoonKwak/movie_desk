# B′5 Phase 1 + 7: nested persistence

## Wire and migration policy

Project JSON envelopes now write version 2, requiring nonempty `timelines`, a
`rootTimelineId`, and a matching derived `timeline` root alias. Sequence clips
are the fifth **closed** clip variant: reference ID and nonnegative trim bounds
are required, volume is optional and nonnegative. Unknown clip kinds fail the
whole load. Collections retain their existing forward-compatible policy;
optional invalid audio blocks still recover independently.

Library and snapshot rows have no version field. No Dexie upgrade or bulk rewrite
is performed. At read time, presence of **either** `timelines` or
`rootTimelineId` selects strict current-shape validation. Neither field means
legacy v1: validate the old structure, retain an existing timeline ID or derive
`projectId:root`, and produce a one-element collection in memory. Ambiguous or
partial nested shapes fail; they never fall back to v1. A v1 envelope follows
this same conservative inference, while a v2 envelope always uses the strict
parser even when both fields are missing.

Opening/migrating a library row never writes it. A session WeakSet identifies
restored project objects, preventing startup/load-triggered library autosave.
Inline-preview cache maintenance inherits this read-only marker and does not flush
the original JSON or CRDT either. An actual edit produces a new project object
and saves the current shape.
Explicit JSON export and snapshot creation also write the current shape.
Failed library loads return the original raw JSON and a reason shown by both
the open menu and startup path; the row is retained. Failed snapshot loads retain
their row and the existing snapshot UI reports corruption.

## CRDT v3 and atomicity

Each timeline has separate metadata, track map, track order and track clip order.
Flat clip keys are JSON tuples `[timelineId, clipId]`; scoped track/order names
also encode JSON tuples. IDs may collide across timelines without aliasing.
Within one timeline duplicate track or clip IDs are rejected.

Schema 2 is reconstructed from the unique order lists, validated and
converted in memory. The complete document is copied to an isolated Y.Doc;
schema 3 is written and read/validated there before a single delta update is
applied to the original document. This staging is required because a Yjs
transaction batches observers but **does not roll back on exceptions**.
Validation or staging failure throws NestedTimelineError and changes no encoded
source bytes. Unsupported or incomplete schemas also throw instead of returning
null (null is reserved for an empty document).

Order lists are authoritative in schemas 2 and 3. A concurrent delete versus
move may leave a map value without an order reference; these unreachable values
are ignored, and the next write removes them. Ordered missing/mismatched entries,
repeated clip ownership, and invalid required metadata still fail validation.
This preserves recovery from normal CRDT conflicts without silently dropping a
clip that remains in a track's order. Two independent Y.Doc replicas reproduce
this race for both schemas, then migrate/edit/reopen successfully.

The pre-migration encoded backup is embedded only up to 1 MiB; larger documents
retain the original roots until schema 3 commits, without another full embedded
copy. A pending-cleanup marker survives reload. Backup and legacy roots are
removed only after a schema-3 IndexedDB write transaction completes. Cleanup
then compacts the physical update log in a single read/write transaction: merge
all disk updates (including other tabs), apply cleanup, clear and store the
compacted state. An abort rolls back that disk replacement. Backup/cleanup write
failures set the document save error and retain retry eligibility; failed deltas
are covered by a full checkpoint on retry. Schema-3 documents with a pending
backup retry cleanup on next open.

`checked-indexeddb.ts` replaces y-indexeddb's unobserved update listener while
retaining its hydration/destroy protocol. It uses the dependency's declared
`_storeUpdate`, `_dbref`, and `_dbsize` fields; changes to those fields on a
future dependency upgrade require revalidation. Tests exercise transaction
aborts, synchronous quota errors, physical backup removal, and concurrent-tab
preservation. Compaction also runs after 500 updates to bound the log.

Hydration blocks both live and library writes until successful restoration.
Failure keeps those writes blocked for that project session and displays the
reason. Ordinary loads no longer immediately rewrite CRDT state. Successful
schema migration itself is the one intentional read-triggered CRDT mutation.
Ordinary flush validation errors are caught inside the store listener, display
a save failure, and retry on the next valid edit rather than blocking hydration.
Saved acknowledges IndexedDB transaction completion, not a queued microtask.
The current CRDT candidate always goes through the strict current parser; tests
capture that candidate and assert its nested fields outside the injected parser,
so an assertion cannot be swallowed by production error wrapping.

A missing active library row recovered from CRDT is inserted directly
after hydration, making it visible without an edit. The insert checks for an
existing row in the same Dexie transaction and never rewrites it. Invalid child
track audio participates in the session recovery notification; malformed stored
project fields get a concise reason rather than a raw Zod issue dump.

The version-2 JSON root alias remains stored alongside `timelines`: current
importers and compatibility root writers require the alias, and changing its
presence would be another wire-format change. This intentionally retains root
JSON duplication in library/snapshot rows; a future compact envelope can derive
it during parsing. The redundant whole-project JSON clone before CRDT writes
is removed: parsing already produces validated objects, and per-entity writes
clone values when inserting them into Yjs. Strict validation remains on saves.
The paired 1,000-asset/1,000-clip Chromium write benchmark records its scope and
before/after results in the round-2 report.

## Scope

This delivers persistence and SequenceClip representation, not recursive render,
audio traversal, cycle/depth linting, compound creation or timeline tabs. Graph
policy remains Phase 2, rendering Phases 3–4, audio Phase 5 and editing/UI Phase 6.
Root-alias writers are normalized at write boundaries; children remain intact.
No branch rename, main integration, push or destructive row migration is needed.
