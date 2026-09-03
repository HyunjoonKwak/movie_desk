# Honest gap analysis — where we are vs FCP / CapCut / DaVinci Resolve

First written 2026-05 and **re-audited 2026-07-16** against the current tree.
The tables describe shipped behavior, not the original phase plan.

Legend: ✅ shipped • 🟡 partial / needs work • ❌ missing

## 1. Video output (export)

| Capability | Status | Notes |
| -- | :--: | -- |
| H.264 MP4 export (WebCodecs) | ✅ | 4 presets (YT 1080p/4K, TikTok 9:16, Web VP9) |
| Audio mixing into export | ✅ | Bounded chunks, per-channel effects, worker mix, stereo AAC |
| Clip transform applied (pos/scale/rot) | ✅ | Vertex-shader affine transform, keyframe overrides (`compositor.ts`) |
| Transitions rendered | ✅ | fade/dissolve/dip/slide/zoom/spin + GPU wipe mask |
| Effect keyframe interpolation in export | ✅ | Compositor samples per-frame |
| Export progress + cancel button | ✅ | Progress, fps, ETA, working cancel |
| Loudness normalization | ✅ | Stateful streaming LUFS measure + two-pass normalize |
| Stereo export | ✅ | Mono sources duplicate; stereo sources preserve L/R through planar AAC |
| Lossless / proxy export | ❌ | One quality per preset |
| GIF / image-sequence export | ❌ | |

## 2. Subtitle editing

| Capability | Status | Notes |
| -- | :--: | -- |
| Whisper auto-generation | ✅ | Multilingual base q8 + local ONNX runtime, explicit Korean/English language, source-time mapping |
| Dedicated subtitle panel (list view, batch edit) | ✅ | `subtitles/subtitle-panel.tsx` |
| Edit subtitle text inline | ✅ | Panel list + inspector |
| Adjust subtitle timing | 🟡 | Drag/trim works; no numeric precision input |
| SRT / VTT import | ✅ | `srt.ts` parse round-trip |
| SRT / VTT export | ✅ | Burn-in style presets in panel |
| Per-language tracks | ❌ | |
| Karaoke / word-level styling | ❌ | |

## 3. Effects library

| Capability | Status | Notes |
| -- | :--: | -- |
| GPU-accelerated effect chain | ✅ | WebGL2 ping-pong FBO |
| Built-in effects | ✅ | **24 definitions** — see `effects/definitions/` |
| Color correction (contrast/saturation/hue/levels/LUT) | ✅ | + white-balance, vibrance, split-tone, color-wheels |
| Sharpen / unsharp mask | ✅ | `sharpen.ts` |
| Chroma key (green screen) | ✅ | YUV-distance keyer + spill suppression |
| Stylize (sepia/invert/film grain) | ✅ | `sepia`, `invert`, `grain` |
| Audio effects (EQ/gate/fade/denoise) | ✅ | 5 audio effects incl. FFT spectral denoise |
| Effect reordering | ✅ | Drag-and-drop in `effects-section.tsx` |
| 1D LUT support | ✅ | 1D/3D `.cube` files and non-default domain bounds |
| Effect preview thumbnails | ❌ | |

## 4. GPU performance

| Capability | Status | Notes |
| -- | :--: | -- |
| WebGL2 compositor | ✅ | ~550 lines, ping-pong FBO, 22 shaders |
| WebCodecs VideoDecoder for playback | ✅ | `mp4-decoder.ts` + mediabunny demux (`mp4-demux.ts`) |
| LRU VideoFrame cache | ✅ | `video-frame-cache.ts` (tested) |
| WebGPU | ❌ | Future; WebGL2 is fine for now |
| Texture pool / explicit GPU memory cap | ✅ | Bounded LRU caches with deterministic disposal |
| Off-main-thread render (worker) | ❌ | Compositor runs on main; OK for now |
| MediaPipe mask cached per frame | ✅ | Reused at unchanged source time; bounded and disposed |
| Scene-detect / motion-track use WebCodecs decoder | ❌ | Still serial `<video>.currentTime` seeking — slow |

## 5. Component / editing UX

| Capability | Status | Notes |
| -- | :--: | -- |
| Domain folder layout | ✅ | timeline/preview/media/effects/ai/etc |
| Per-clip transform UI | ✅ | `transform-section.tsx` — x/y/scale/rot/opacity + keyframes |
| Effect reorder / category browser | ✅ | Drag reorder + grouped add menu |
| Multi-select (marquee) | ✅ | Cmd/Ctrl+drag in `timeline-panel.tsx` (+ shift-click) |
| Context menus (right-click) | ✅ | Radix `clip-context-menu.tsx` |
| Keyboard nav / shuttle (J/K/L) | ✅ | `use-keyboard-shortcuts.ts` + blade/markers/nudge/group |
| Markers / chapter notes | ✅ | `marker-panel.tsx` + strip + YouTube-chapter export |
| Command palette (Cmd+K) | ✅ | + shortcut cheatsheet |
| **React error boundaries** | ✅ | **Added 2026-07** — route `error.tsx` + preview panel isolation |

## 6. Local file management

| Capability | Status | Notes |
| -- | :--: | -- |
| OPFS-backed media blobs | ✅ | Survives reload, browser restart |
| Yjs project persistence | ✅ | IndexedDB |
| Multi-project library | ✅ | `project-library.ts` + `project-menu.tsx` |
| JSON project export / import | ✅ | `project-export.ts` (now round-trip tested) |
| Media bin search / filter / delete | ✅ | + OPFS storage meter |
| Version snapshots | ✅ | Named save/restore/delete UI with validated restore |
| Media metadata (codec, bitrate, fps) | 🟡 | Only width/height/duration captured |
| Trash / recycle bin | ❌ | No restore UI; blob cleanup is deferred to safe startup GC |

## What actually remains — the real backlog (2026-07-16)

The load-bearing reliability backlog identified in the earlier audit is closed:
CI runs lint/typecheck/unit/build/browser tests plus an OSV production dependency
audit; persistence is validated and corruption-safe; renderer caches are bounded;
and export
preserves stereo. The final OSV pass checked 179 production packages with zero
known vulnerabilities.

The remaining items are product expansion, maintenance, or performance polish:

1. **Broader interaction coverage.** 132 automated unit/protocol tests plus
   three Playwright flows pass, but complex drag/trim/mask/multicam UI
   interactions and AI cancellation paths still rely mainly on manual testing.
2. **AI analysis speed.** Scene detection and motion tracking still seek a
   media element serially instead of sharing the WebCodecs decoder.
3. **Main-thread rendering.** The compositor is bounded but remains on the main
   thread; an OffscreenCanvas worker or WebGPU backend is future work.
4. **Feature expansion.** Per-language subtitle tracks/translation, effect
   preview thumbnails, GIF/image-sequence export, and compound sequences.
5. **Dependency maintenance.** `mp4-muxer` is deprecated upstream and should
   eventually move to its maintained successor. MediaPipe also emits a dynamic
   dependency warning during bundling. Both current paths build and package
   successfully; neither is a present runtime blocker.

Everything flows through the same immutable command pipeline, so undo/redo
stays free as these land.
