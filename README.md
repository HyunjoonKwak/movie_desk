# Movie Desk

**English** · [한국어](README.ko.md)

**Movie Desk is a local-first video workstation that combines a serious media
library with professional-grade editing while guiding first-time editors from
import to final export, delivered as a macOS app.** It makes powerful tools approachable through good
defaults and progressive disclosure instead of removing their depth. Local AI
assists with analysis, search, transcription, suggestions, and optional rough
cuts; the user keeps final control and precise finishing. Footage never leaves
the device. Prebuilt macOS apps are on the
[Releases page](../../releases/latest).

Repository and local folder: `movie_desk`. Started from a study of
[OpenCut](https://github.com/OpenCut-app/OpenCut) (cloned into `reference/`
for offline reading; not part of the build). Legacy storage identifiers remain
unchanged so projects created before the rename still open normally.

## Where it fits

Movie Desk takes three product categories as simultaneous quality bars: the
organisation and search of a media manager, the approachable first run of a
guided app, and the depth, precision, and performance of a professional editor.
It joins work that otherwise forces users to move among a file manager, an
automatic editing app, and a professional NLE. The table below compares only
the assisted-editing direction; it does not define the product's full scope.

| | Photo-app auto memories (Google Photos, Apple Memories) | Template apps (CapCut, GoPro Quik) | **Movie Desk** |
|--|:--:|:--:|:--:|
| Footage stays on your device | varies | varies | ✅ local media, analysis, storage |
| Shows why each shot was picked | ❌ | ❌ | ✅ reason per pick |
| Respects your pins and exclusions, then re-cuts | ❌ | partial | ✅ re-assemble, one undo |
| Rejected shots are one click from coming back | ❌ | ❌ | ✅ rejected-candidate browser |
| Story from GPS and dates (days, places, moves) | partial | ❌ | ✅ offline geocoding |
| Music: find, credit, beat-snap | automatic | library | ✅ guided flow + free-music import |
| Finish on a real timeline (ripple, keyframes, LUTs, subtitles) | ❌ | partial | ✅ |
| Free and open source | ❌ | ❌ | ✅ MIT |

Final Cut Pro and DaVinci Resolve remain the bars for editing depth, precision,
performance, and reliability.
[`docs/01-feature-matrix.md`](docs/01-feature-matrix.md) tracks the timeline,
effects, and export against them, and
[`docs/02-architecture.md`](docs/02-architecture.md) covers the technical plan.

## What ships today

| Layer | Feature |
|--|--|
| Core model | Immutable Project / Track / Clip / Effect / Keyframe / Transition + undo/redo |
| Timeline | Multi-track, magnetic snap, ripple, trim/split/move, drag-between-tracks, pinch-zoom |
| Renderer | WebGL2 compositor, ping-pong FBOs, multi-pass effect chain, keyframe interpolation |
| Effects | 24 built-in GPU/audio effects, 1D/3D `.cube` LUTs, vector masks, blend modes, and background removal |
| Text | Canvas2D-rendered text clips with size/color/bg controls + a dedicated subtitles track |
| Media | OPFS-backed assets, thumbnail/filmstrip/waveform probe, drag-drop ingest with progress + cancel, capture-time ordering with day/place groups (offline geocoded), proxies, thumbnail sizing, marquee multi-select, use/skip marks, per-asset usable-range trim |
| AI (local execution) | Auto silence cut (WebAudio RMS), Whisper transcription (HuggingFace), Scene detect (χ²), Background removal (MediaPipe Selfie), Smile detection (FaceLandmarker), opt-in semantic tags/dedup (MobileCLIP). Some models require a first-use download |
| Auto-edit | 6-step wizard for travel/landscape footage: junk filter (blur/exposure/shake), interest scoring, beat-grid assembly with photo stacks + Ken Burns, GPS/date story chapters with offline geocoding, rendered map-transition clips, YouTube Audio Library / Suno music flow, beat-snap re-conform when music changes — applied as one undo step on dedicated AUTO tracks |
| Export | WebCodecs H.264/VP9/AV1 + chunked stereo AAC mixer, streaming LUFS normalization, work ranges, four presets |
| Persistence | Validated project library + snapshots, Yjs/IndexedDB state, OPFS media, corruption-safe recovery |
| Mobile | Reactive shell with drawer panels + two-finger pinch zoom |

## Repo layout

```
apps/web/         Next.js 15 editor UI/renderer (including the dev preview)
apps/desktop/     Electron wrapper (macOS .app/.dmg packaging)
packages/core/    Framework-agnostic project model, edit commands, and timeline algorithms
docs/             Identity, architecture, and design notes
reference/        OpenCut clone for study (gitignored)
```

## Development preview

```bash
pnpm install
pnpm dev          # browser development preview: http://localhost:3000
```

Requirements: Node 20+, pnpm 9+.

### Browser E2E tests

```bash
pnpm --filter @movie-desk/web exec playwright install chromium  # first run only
pnpm test:e2e
```

The suite starts an isolated editor server. It verifies navigation, IndexedDB
project recovery after reload, and timeline marquee selection.

## Install on macOS

Movie Desk ships as a macOS desktop application. The browser build under
`apps/web` is a development and automated-test preview, not a separate hosted
product. Use the `.dmg` on the [Releases page](../../releases/latest), or follow
[`apps/desktop/`](apps/desktop/) to build it locally.

### Bundled local AI models

Desktop builds prepare and bundle the MediaPipe runtime, Selfie Segmenter,
Face Landmarker, and the Whisper transcription model (~41 MB,
`Xenova/whisper-tiny.en` q8). Packaged `app://` runs do not use a CDN fallback
to hide a missing model. To prepare only the models manually, run:

```bash
pnpm --filter @movie-desk/web prebundle:models
```

The command checksum-validates Face Landmarker and populates the local public
path with seven Whisper files. Generated assets are gitignored, and the
`apps/desktop` `build:web` and release builds run this command automatically.
MobileCLIP semantic analysis remains an optional feature: its ~55 MB model is
downloaded explicitly only when the user enables it.

## Cutting a release

Release builds are triggered manually via GitHub Actions — never on every
push. The workflow lives at
[`.github/workflows/release.yml`](.github/workflows/release.yml).

**Tagged release (recommended)**

```bash
# 1. Bump the version in apps/desktop/package.json (e.g. 0.2.2 → 0.2.3).
#    The number must match the tag you push next.

# 2. Commit the bump.
git commit -am "chore: bump desktop to 0.2.3"
git push

# 3. Push the tag — this is what fires the workflow.
git tag v0.2.3
git push --tags
```

About 15 minutes later the matching GitHub Release has both `.dmg`s
(`-arm64` and Intel) attached.

Installed apps check the Releases API on launch (and every 4 hours, or via
**Movie Desk → Check for Updates…**) and show a dialog when a newer version
exists — Download opens the matching `.dmg` in the browser. Unsigned builds
cannot self-install, so installation stays a drag-to-Applications step.

**Ad-hoc build** — open the GitHub repo → **Actions** → **Release** →
**Run workflow**. Uses the current `apps/desktop/package.json` version.

Builds are unsigned by default (`identity: null` in `electron-builder.yml`).
After downloading from a GitHub Release, macOS attaches a
`com.apple.quarantine` attribute and shows a misleading **"…is damaged and
can't be opened"** dialog — right-click → Open won't bypass it. Users (or
you) need to strip the attribute once:

```bash
xattr -cr "/Applications/Movie Desk.app"
```

To ship a properly signed + notarised `.dmg` that opens with no prompts at
all, add the Apple Developer secrets to the repo (`CSC_LINK`,
`CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`,
`APPLE_TEAM_ID`) and remove the `identity: null` line — no workflow change
required.

## Roadmap

The plan lives in [`docs/06-master-plan.md`](docs/06-master-plan.md) (Korean).
Phases: 0 restore CI/security and build a Movie Desk release candidate, 1
dogfood one real family set end to end, 2 accept iPhone and camera originals
as-is (HEIC, HEVC, .mov), 3 improve rough-cut quality and analysis speed, 4
complete finishing and sharing, 5 pass regression gates and ship the first
stable `v0.4.0`, 6 mature the media library, professional editor, and guided
workflow together, 7 expand publicly when real users appear.

Not planned: real-time team collaboration, a plugin marketplace, required cloud
upload or accounts, an auto-edit-only product, or mass short-form generation.
