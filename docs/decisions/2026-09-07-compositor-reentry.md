# Compositor frame ownership (Phase 3)

Phase 3 changes ownership and call boundaries; it does not evaluate sequence
clips or recurse through the timeline graph. Phase 4 must retain Phase 2's
cycle/missing/depth policy: failed child evaluation contributes black/empty
pixels without throwing or changing persisted clips.

## Context and lifetime

Each render receives a target and a numeric playhead, defaulting to the canvas
and project snapshot. Visibility, text animation, keyframes, transitions and
source-time evaluation use that captured number. The previous live playhead
closure could evaluate different parts of one frame at different times.

An invocation reserves an unused depth lane until its finally block completes.
The lane is not a graph traversal depth; Phase 4 must separately carry timeline
ancestry and enforce MAX_SEQUENCE_DEPTH. Simultaneous invocations receive
separate PingPong instances and scratch leases. The maximum of eight active
lanes also bounds the number of retained PingPong instances.

Scratch keys are (depth lane, role), with dimensions stored on each entry.
Roles are backdrop, fit, rotation and scene. A different size never invalidates
another role or lane. If an output lease is still held, a later request for the
same key allocates a separate entry. At most one idle entry remains per key;
extra live entries retire when their borrowers release. This avoids both the
old global resize disposal and an unbounded idle cache for every size visited.
Child presentation targets use a separate RGBA8 pool and remain leased until
the caller consumes their texture. Their transparent clear preserves the
parent backdrop; the root retains opaque black for preview/export parity.

The source-target key is (depth lane, source width, source height), because
source normalization is mutable and two depths must never upload into the same
slot. Immutable images remain shared; their source identity/currentSrc version
has a separate cache key so a reload cannot replace an older leased target. Source/image byte limits are unchanged
and shared by all depths, rather than multiplied by the number of frames.

Cache leases pin an entry until the current clip has been composited, including
any intervening await; the frame finally block releases them on early return
or failure. Pinned bytes and entries still count toward the original limits.
Reservations check the entire request before evicting idle entries; they cannot
evict a parent's working set. Exhaustion returns a black/empty frame. Retain,
delete and disposal retire a pinned entry but cannot destroy it until its last
borrower releases. The release function is idempotent.

Raw uploads and mask caches also include the depth lane. Retention uses the
union of active frame assets/graphics, so another project snapshot cannot
retire a suspended frame's resources. DOM source acquisition, seeking, upload
and segmentation share a narrow asynchronous critical section: mutable media
elements cannot be sought to two timestamps at once. Rendering itself is never
locked, so other frames can make GPU progress while source acquisition waits.
No borrowed decoded frame crosses an await before upload.

## Mandatory Phase 4 source-lock invariant

**A nested renderFrame call must never occur inside the withSource critical
section.** A child that needs media would wait for the queue held by its parent,
while that parent waits for the child: a permanent deadlock. Sequence dispatch
must be a separate branch of uploadClip, outside the media-only withSource
callback. The callback owns source acquisition, upload and segmentation only;
it must not evaluate a timeline or invoke another render.

A global "source lock held" rejection in renderFrame would be incorrect:
independent overlapping renders are allowed while a media source is awaiting
I/O (and are covered by browser tests). JavaScript supplies no implicit async
caller ancestry. Phase 4 must pass explicit parent-context ownership if it
adds a runtime ancestry assertion; checking a global boolean would reject valid
reentry while still failing to describe which caller owns the lock.

## GL and alpha boundaries

Explicit-target GPU sections save and restore independent read/draw framebuffer
bindings and viewport synchronously. Default screen rendering retains the
existing ownership contract: it owns the canvas state and ends on the screen.
It does not query/restore caller state per clip. That default fast path avoids
repeated synchronous GL queries on the preview/export hot path; explicit child
calls still restore each synchronous section independently. Each section
establishes its own blend state and returns to premultiplied-over blending;
no suspended frame borrows blend state. A saved GL binding must
not span an await: overlapping completions are not guaranteed to be LIFO.
Each draw binds its own program, textures and uniforms; no suspended render
relies on those transient bindings. Target allocation preserves read/draw
bindings too. Explicit target export readback restores its read binding and
leaves draw binding alone; the default export still captures the existing
screen presentation boundary. Scope readback accepts an explicit target.

The single possible bypass source uploads before scene initialization. If it
has alpha, only that frame context is promoted, before its scene is cleared.
Multi-clip/processed frames are managed from the start. Uploads cannot clear a
partially composited scene, and root clear color and transfer order stay intact.

## Deliberate tradeoffs and review status

- Keep one compositor with explicit frame arguments rather than a mutable
  current-frame stack: async completions can occur out of stack order.
- Serialize mutable source access rather than duplicate decoder/media caches
  per depth, which would multiply the existing resource budgets.
- Preserve source/image budget accounting, returning an empty contribution
  when active leases occupy it rather than evicting live parents or increasing
  the cap silently.
- Pixel, performance and gate evidence is collected in the
  [evaluation report](../evaluations/2026-09-07-b5-phase3-report.md).
  No sequence rendering is added.
