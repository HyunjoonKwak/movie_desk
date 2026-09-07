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

Schema 2 is reconstructed without filtering out missing entities, validated and
converted in memory. The complete document is copied to an isolated Y.Doc;
schema 3 is written and read/validated there before a single delta update is
applied to the original document. This staging is required because a Yjs
transaction batches observers but **does not roll back on exceptions**.
Validation or staging failure throws NestedTimelineError and changes no encoded
source bytes. Unsupported or incomplete schemas also throw instead of returning
null (null is reserved for an empty document).

Legacy track/clip roots remain. Additionally, `migration-backup-v2.update`
contains the complete pre-migration encoded Yjs update, including original
metadata, media and collection roots that later edits can change. Applying these
bytes to a fresh Y.Doc restores the pre-migration state. Retaining roots alone
would not preserve overwritten project-meta values; the one-time storage cost
is justified by recoverability. No automatic pruning is introduced.

Hydration blocks both live and library writes until successful restoration.
Failure keeps those writes blocked for that project session and displays the
reason. Ordinary loads no longer immediately rewrite CRDT state. Successful
schema migration itself is the one intentional read-triggered CRDT mutation.
The current CRDT candidate always goes through the strict current parser; tests
remove either or both nested fields at this actual boundary and require failure.

## Scope

This delivers persistence and SequenceClip representation, not recursive render,
audio traversal, cycle/depth linting, compound creation or timeline tabs. Graph
policy remains Phase 2, rendering Phases 3–4, audio Phase 5 and editing/UI Phase 6.
Root-alias writers are normalized at write boundaries; children remain intact.
No branch rename, main integration, push or destructive row migration is needed.
