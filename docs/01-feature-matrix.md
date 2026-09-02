# Feature matrix: Movie Desk vs OpenCut vs CapCut vs Final Cut Pro

This is a directional product comparison, not a benchmark or compatibility
promise. The Movie Desk column reflects the current repository as of
2026-07-16.

Legend: ✅ shipped • 🟡 partial • ❌ missing • ⭐ differentiator

## Editing core

| Capability | OpenCut | CapCut | FCP | Movie Desk current |
| --- | :---: | :---: | :---: | :---: |
| Multi-track timeline | ✅ | ✅ | ✅ | ✅ |
| Magnetic snap and ripple edits | 🟡 | 🟡 | ✅ | ✅ |
| Roll / slip / slide / split | 🟡 | 🟡 | ✅ | ✅ |
| Compound / nested sequences | ❌ | 🟡 | ✅ | ❌ |
| Frame-aware scrub and playback | ✅ | ✅ | ✅ | ✅ |
| Keyframed transforms/effects/speed | ✅ | ✅ | ✅ | ✅ |
| Pitch-preserving speed changes | ✅ | ✅ | ✅ | ❌ |
| Color scopes, grading, 1D/3D LUTs | 🟡 | 🟡 | ✅ | ✅ |
| Multicam program editing | ❌ | ❌ | ✅ | ✅ ⭐ |

## Effects and graphics

| Capability | OpenCut | CapCut | FCP | Movie Desk current |
| --- | :---: | :---: | :---: | :---: |
| GPU effect chain | ✅ | ✅ | ✅ | ✅ |
| Vector clip masks / blend modes | ✅ | ✅ | ✅ | ✅ |
| Text, subtitle, and shape clips | ✅ | ✅ | ✅ | ✅ |
| Sticker/template catalog | ✅ | ✅ | 🟡 | ❌ |
| Transitions | ✅ | ✅ | ✅ | ✅ |

## Local AI and automation

| Capability | OpenCut | CapCut | FCP | Movie Desk current |
| --- | :---: | :---: | :---: | :---: |
| Automatic subtitles | ✅ | ✅ | 🟡 | ✅ local Whisper |
| Multilingual translation | 🟡 | ✅ | ❌ | ❌ |
| Silence removal | ❌ | ✅ | ❌ | ✅ local |
| Scene detection | ❌ | ✅ | 🟡 | ✅ local |
| Background removal | ❌ | ✅ | 🟡 | ✅ local MediaPipe |
| Motion tracking | ❌ | ✅ | ✅ | ✅ local |
| Beat markers | 🟡 | ✅ | 🟡 | ✅ local |
| Automatic white balance | 🟡 | 🟡 | ✅ | ✅ local |
| Voice/stem isolation | 🟡 | ✅ | 🟡 | ❌ |
| Automatic B-roll suggestions | ❌ | 🟡 | ❌ | ❌ |

## Persistence

| Capability | OpenCut | CapCut | FCP | Movie Desk current |
| --- | :---: | :---: | :---: | :---: |
| Named local snapshots | 🟡 | ✅ | ✅ | ✅ |
| Offline-first project/media storage | 🟡 | ❌ | n/a | ✅ ⭐ |
| Hosted cloud project service | ✅ | ✅ | 🟡 | ❌ |
| JSON project portability | ✅ | ❌ | 🟡 | ✅ |

## Output and platform

| Capability | OpenCut | CapCut | FCP | Movie Desk current |
| --- | :---: | :---: | :---: | :---: |
| H.264 / VP9 / AV1 video | 🟡 | ✅ | ✅ | ✅ |
| Stereo AAC and LUFS normalization | 🟡 | ✅ | ✅ | ✅ |
| Work-range and social presets | 🟡 | ✅ | ✅ | ✅ |
| GIF / image sequence | 🟡 | ✅ | ✅ | ❌ |
| Browser / installable PWA | ✅ | ✅ | ❌ | 🟡 development preview, not a product target |
| Packaged desktop app | 🟡 | ✅ | ✅ | ✅ Electron (macOS product) |
| Native iOS / Android shell | 🟡 | ✅ | ❌ | ❌ |
| Open source / self-hostable | ✅ | ❌ | ❌ | ✅ ⭐ |

## North star

The product target has three equal pillars:

1. a serious media library for large, reusable, safely managed collections;
2. professional editing depth, precision, performance, and export quality;
3. a guided first-success path plus optional local AI assistance that never takes
   control away from the editor.

Movie Desk must make advanced capability approachable through progressive
disclosure, not by lowering the ceiling. Source media stays local, automatic
changes remain explainable and reversible, and a normal project should not need
another editor for final finishing.
