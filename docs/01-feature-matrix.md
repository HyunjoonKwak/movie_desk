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
| Browser / installable PWA | ✅ | ✅ | ❌ | ✅ |
| Packaged desktop app | 🟡 | ✅ | ✅ | ✅ Electron (macOS release) |
| Native iOS / Android shell | 🟡 | ✅ | ❌ | ❌ |
| Open source / self-hostable | ✅ | ❌ | ❌ | ✅ ⭐ |

## North star

The differentiating combination remains:

1. open and self-hostable;
2. useful local AI without uploading source media;
3. an AI rough cut the user reviews and overrides, never a black box;
4. one web codebase shared by PWA and desktop packaging.
