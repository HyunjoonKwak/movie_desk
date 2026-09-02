# cut_editor — current architecture

This document describes the code that ships today. Future work belongs in the
README roadmap or `04-honest-gap-analysis.md`; it should not be presented here
as if it were already implemented.

## Principles

1. **Web source of truth.** The Next.js editor owns product behavior. Electron
   wraps the static web build and adds native menus, save dialogs, and updates.
2. **Local-first storage.** Project state lives in Yjs/IndexedDB, library and
   snapshot records in Dexie, and binary media in OPFS. Nothing leaves the device.
3. **Immutable editing core.** `packages/core` contains the project model,
   command history, and pure timeline algorithms. Zustand integrates them into
   the UI without mutating projects in place.
4. **One compositor.** Preview and export both use the WebGL2 compositor, so
   transforms, masks, transitions, effects, and keyframes share behavior.
5. **Bounded resources.** Decoded frames, media elements, textures, LUTs, text
   surfaces, and segmentation masks have explicit cache limits and disposal.

## Runtime map

```text
Next.js / React editor
  ├─ editor + domain panels
  ├─ Zustand project/history/UI stores
  │    └─ @cut/core immutable edit and timeline functions
  ├─ preview
  │    ├─ WebCodecs MP4 decoder + bounded VideoFrame cache
  │    ├─ HTML media fallback + Web Audio playback
  │    └─ WebGL2 compositor
  ├─ export
  │    ├─ same WebGL2 compositor
  │    ├─ WebCodecs video/audio encoders
  │    └─ mp4-muxer + stereo DSP worker
  ├─ persistence
  │    ├─ Yjs + y-indexeddb (live document)
  │    ├─ Dexie (project library and snapshots)
  │    └─ OPFS (source media and proxies)
  └─ local AI
       ├─ HuggingFace Whisper transcription
       ├─ MediaPipe segmentation
       └─ WebAudio/Canvas analysis for silence, beats, scenes, and motion
```

## Repository layout

```text
apps/web/
  e2e/                 Playwright navigation, persistence, and timeline flows
  scripts/             model preparation
  src/
    ai/                local analysis and model-backed tools
    app/               Next.js routes and error boundaries
    autoedit/          analysis, scoring, assembly, story, and the wizard
    editor/            shell and inspector panels
    effects/           effect definitions and LUT persistence
    hooks/             shortcuts, file drop, breakpoints
    i18n/              Korean/English messages and locale store
    export/            WebCodecs export, audio DSP, presets
    media/             ingest, probe, proxy, thumbnail, waveform, capture-day grouping
    music/             reference library, recommendation, free-music import
    persistence/       live Yjs document, Dexie, OPFS, import/export, snapshots, GC
    preview/           viewport, scopes, audio engine, guides
    renderer/          compositor, shaders, decode and resource caches
    stores/            project and UI state
    subtitles/         subtitle editor and SRT/VTT handling
    timeline/          timeline UI and interactions
apps/desktop/          Electron wrapper and packaging
packages/core/         model, command history, timeline algorithms
```

## Rendering and playback

At each playhead time, the compositor resolves visible clips, obtains an image
or decoded video frame, applies the ordered effect chain through ping-pong FBOs,
then composites the result using transform, opacity, blend mode, vector mask,
and transition uniforms. Video decoding prefers WebCodecs for MP4 assets and
falls back to a seeked media element for unsupported inputs.

GPU and browser resources are deterministic: LRU caches dispose evicted
textures/elements/frames, and every compositor is explicitly disposed after
preview replacement or export.

## State and persistence

`useProjectStore` is the UI-facing project state. Local content changes are
written synchronously into native Yjs maps/arrays. `y-indexeddb` restores the
active document, while Dexie keeps the multi-project picker and named
snapshots. Stored JSON is validated before loading; a damaged record falls
back safely and suspends destructive media GC.

## Export

The exporter advances a virtual playhead through the same compositor and feeds
frames to WebCodecs. Audio assets are decoded through a two-entry LRU and mixed
in bounded 30-second chunks at 48 kHz. Per-clip effects receive overlap padding;
ducking state and streaming LUFS filter state continue across chunk boundaries.
Chunks are encoded directly as planar stereo AAC, so PCM memory does not grow
with timeline duration. Optional work ranges and normalization are applied
before muxing.

## Quality gates

CI and local commands share the same gates:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
pnpm --filter @cut/web knip
```

Unit tests cover the core timeline, the Yjs document schema, persistence
validation/GC, renderer caches/decoding, LUT parsing, subtitles, auto-edit
scoring and assembly, music recommendation, and audio DSP. Playwright covers
navigation, reload persistence, and timeline marquee selection.
