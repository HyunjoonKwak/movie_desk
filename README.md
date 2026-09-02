# Movie Desk

**English** · [한국어](README.ko.md)

**Movie Desk is a local-first AI video editor anyone can start using without
learning editing first.** Drop in the footage you have been collecting and it
organizes it, proposes a direction, and creates a first cut. You decide and
finish from there; your footage never leaves your device. Prebuilt macOS apps
are on the [Releases page](../../releases/latest).

Repository and local folder: `movie_desk`. Started from a study of
[OpenCut](https://github.com/OpenCut-app/OpenCut) (cloned into `reference/`
for offline reading; not part of the build). Legacy storage identifiers remain
unchanged so projects created before the rename still open normally.

## Why another editor?

| | Final Cut Pro | CapCut | OpenCut | **Movie Desk** |
|--|:--:|:--:|:--:|:--:|
| Open source | ❌ | ❌ | ✅ | ✅ |
| Free for everything | ❌ | partial | ✅ | ✅ |
| Browser-native | ❌ | ❌ | ✅ | ✅ |
| AI: subtitles + scene + silence | partial | ✅ | partial | ✅ |
| Local AI (Whisper, MediaPipe) | ❌ | ❌ | partial | ✅ |
| On-device auto-edit (travel/landscape) | ❌ | cloud | ❌ | ✅ |
| Magnetic timeline + ripple | ✅ | ❌ | partial | ✅ |
| Mobile-first gestures | n/a | ✅ | ❌ | ✅ |
| Local-first persistence | partial | ❌ | partial | ✅ |

See [`docs/01-feature-matrix.md`](docs/01-feature-matrix.md) for the full
matrix and [`docs/02-architecture.md`](docs/02-architecture.md) for the
technical plan.

## What ships today

| Layer | Feature |
|--|--|
| Core model | Immutable Project / Track / Clip / Effect / Keyframe / Transition + undo/redo |
| Timeline | Multi-track, magnetic snap, ripple, trim/split/move, drag-between-tracks, pinch-zoom |
| Renderer | WebGL2 compositor, ping-pong FBOs, multi-pass effect chain, keyframe interpolation |
| Effects | 24 built-in GPU/audio effects, 1D/3D `.cube` LUTs, vector masks, blend modes, and background removal |
| Text | Canvas2D-rendered text clips with size/color/bg controls + a dedicated subtitles track |
| Media | OPFS-backed assets, thumbnail/filmstrip/waveform probe, drag-drop ingest with progress + cancel, capture-time ordering with day/place groups (offline geocoded), proxies, thumbnail sizing, marquee multi-select, use/skip marks, per-asset usable-range trim |
| AI (all local) | Auto silence cut (WebAudio RMS), Whisper transcription (HuggingFace), Scene detect (χ²), Background removal (MediaPipe Selfie), Smile detection (FaceLandmarker), opt-in semantic tags/dedup (MobileCLIP) |
| Auto-edit | 6-step wizard for travel/landscape footage: junk filter (blur/exposure/shake), interest scoring, beat-grid assembly with photo stacks + Ken Burns, GPS/date story chapters with offline geocoding, rendered map-transition clips, YouTube Audio Library / Suno music flow, beat-snap re-conform when music changes — applied as one undo step on dedicated AUTO tracks |
| Export | WebCodecs H.264/VP9/AV1 + chunked stereo AAC mixer, streaming LUFS normalization, work ranges, four presets |
| Persistence | Validated project library + snapshots, Yjs/IndexedDB state, OPFS media, corruption-safe recovery |
| Mobile | Reactive shell with drawer panels + two-finger pinch zoom |

## Repo layout

```
apps/web/         Next.js 15 app (editor UI)
apps/desktop/     Electron wrapper (macOS .app/.dmg packaging)
packages/core/    Framework-agnostic project model, edit commands, and timeline algorithms
docs/             Identity, architecture, and design notes
reference/        OpenCut clone for study (gitignored)
```

## Quick start

```bash
pnpm install
pnpm dev          # http://localhost:3000
```

Requirements: Node 20+, pnpm 9+.

### Browser E2E tests

```bash
pnpm --filter @movie-desk/web exec playwright install chromium  # first run only
pnpm test:e2e
```

The suite starts an isolated editor server. It verifies navigation, IndexedDB
project recovery after reload, and timeline marquee selection.

## Install as an app on macOS

Movie Desk ships a PWA manifest + service worker so you can install it as a
standalone desktop window — no extra tooling required. Prefer a native app?
Grab the prebuilt `.dmg` from the [Releases page](../../releases/latest).

**Safari (recommended on macOS)**

1. Open the running site (e.g. `https://your-host/editor`) in Safari 17+.
2. **File → Add to Dock…**
3. Confirm the name and icon, then click Add.

The app launches in its own window with no browser chrome and gets its own
dock entry. The bundled service worker caches the app shell so you can keep
editing through brief network drops.

**Chrome / Edge**

Click the install icon (⊕) in the address bar, or **File → Install** to add
the app to Launchpad and the dock.

For a fully-native `.app` bundle with menus, file dialogs, and auto-update
see [`apps/desktop/`](apps/desktop/).

### Bundled local AI models

MediaPipe (background removal) wasm runtime and the Selfie Segmenter model
are vendored under `apps/web/public/mediapipe/`, so background removal works
fully offline.

The Whisper transcription model (~40 MB, `Xenova/whisper-tiny.en` quantised
to `q8`) is downloaded from HuggingFace on first use and cached by the
browser's HTTP cache thereafter. To make it offline-from-first-launch (e.g.
for the desktop bundle), run:

```bash
pnpm --filter @movie-desk/web prebundle:whisper
```

The script populates `apps/web/public/whisper/Xenova/whisper-tiny.en/` with
the 7 model files (~41 MB). The runtime checks that path first via
`env.localModelPath` and only falls back to HuggingFace if a file is missing.
The directory is gitignored; rerun the script after each clean checkout or
inside the desktop build pipeline.

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

## Roadmap (post v0.2)

- WebGPU renderer and WGSL shader support
- Compound / nested sequences
- Background render queue
- Per-language subtitle tracks and translation workflow
- Effect preview thumbnails and GIF / image-sequence export
- Mobile native shells (Capacitor)

### Deferred (assessed, not yet shipped)

- **Compound / nested sequences.** Wrapping a clip range into a reusable
  sub-timeline. Requires recursive rendering (render the inner sequence
  to an offscreen FBO, sample that as the parent clip's source) and a
  new `kind: "compound"` in the discriminated union with non-trivial
  serialisation / undo considerations. Estimated 2–3 days for an
  MVP that covers playback + edit, longer for full keyframe propagation.
- **Background render queue.** Running the export pipeline in a separate
  Electron `BrowserWindow` / `utilityProcess` so the user keeps editing
  while a render completes. The pipeline currently runs in the main
  renderer (WebCodecs lives there). Splitting it cleanly requires a
  shared OPFS layer and an IPC encoder bridge — estimated 2 days for the
  desktop bundle alone, more if we want web parity.
