# Movie Desk project direction

This file is the first product-direction reference for Claude Code and other coding
agents working in this repository. Read it before proposing features, changing UX,
or reprioritising the roadmap.

## Authoritative product goal

> **Movie Desk is a local-first video workstation that combines a serious media
> library with professional-grade editing, while guiding a first-time editor
> clearly from import to final export.**

The goal is not to make a small editor by removing advanced capability. The goal
is to make powerful organisation and editing approachable through progressive
disclosure, good defaults, contextual explanation, and a coherent workflow. A new
user and an experienced editor should be able to use the same project and grow
into deeper control without moving to another application.

## Three equal product pillars

1. **Media library** — ingest large real-world collections; inspect, organise,
   search, tag, group, relink, proxy, and reuse footage while protecting originals.
2. **Professional editor** — provide a precise, performant, reliable multi-track
   timeline with the finishing depth needed for picture, titles, colour, audio,
   subtitles, effects, and high-quality export.
3. **Guidance and assistance** — explain the current state and next useful action,
   offer safe defaults, and use local AI for analysis, search, transcription,
   suggestions, and optional rough cuts. Assistance accelerates decisions; it does
   not take ownership of them.

None of these pillars may be treated as a disposable add-on. A feature that makes
the app easier must not impose a low ceiling on expert work, and an advanced
feature must not make the basic path unnecessarily harder to understand.

## Product platform

Movie Desk is a **macOS local desktop application**, like Photo Desk. The
Next.js code under `apps/web` is the shared renderer/UI implementation and a
development preview, not a separate cloud or browser product that needs feature
parity. Product and architecture decisions should prioritise native filesystem
access, macOS media frameworks, offline operation, and desktop reliability.
Users may choose any destination for an exported movie; export location is not
part of the product identity.

## Non-negotiable product rules

- **Progressive disclosure, not simplification by deletion.** Keep the first path
  clear, then reveal precision and depth when the user needs them.
- **One workspace from beginner to expert.** Do not split the product into a toy
  mode and a real editor, or require another editor to finish normal work.
- **Local-first and account-free.** User media is not uploaded to a cloud service.
  Any optional model download must be explicit; once installed, core work should
  continue locally.
- **User control is final.** AI output is a suggestion or draft, must explain
  consequential choices, and must be reversible. Never silently overwrite manual
  edits.
- **Originals and projects are safe.** Never silently move, delete, overwrite, or
  degrade source media. Saving, recovery, relinking, and export failures must be
  understandable and recoverable.
- **Real footage is the benchmark.** Judge capability and performance with large,
  mixed collections and complete projects, not isolated demo interactions.
- **Korean-first, bilingual-ready.** Korean is the primary product language;
  English is maintained in parallel where the project already supports it.
- **Photo Desk is the design sibling.** Share its typography, colour language,
  density, and restraint, while preserving a workflow designed for moving-image
  organisation and editing.

## Explicit non-goals

- one-click automatic editing as the whole product
- mass short-form or template-content generation
- required cloud upload, cloud accounts, or cloud-dependent editing
- real-time team collaboration and a plugin marketplace at the current stage

These non-goals do not justify weakening the media library, timeline, performance,
precision, finishing tools, or export quality.

## Decision check for every substantial change

Before implementing or approving a change, answer:

1. Which of the three pillars does it improve?
2. Does it make the first successful path clearer?
3. Does it preserve or increase expert control and precision?
4. Does it keep media local and originals safe?
5. Can it be verified in a complete real-footage workflow?

If a proposal conflicts with the authoritative goal above, do not implement it
without first updating the product decision with the user.

## Document order

- `CLAUDE.md`: mandatory working constraints and product guardrails.
- `docs/00-identity.md`: full product identity and product-boundary explanation.
- `docs/06-master-plan.md`: phased execution plan and current priorities.
- `docs/07-work-order.md`: ordered implementation batches and completion gates.
- `docs/01-feature-matrix.md`: capability coverage and competitive reference.
- `docs/02-architecture.md`: technical architecture.

The current public name is **Movie Desk** (`movie_desk` repository,
`movie-desk` package scope). It is a personal-project name and may be replaced
before commercial release; do not let the temporary name constrain the product.
