# @movie-desk/desktop

**English** · [한국어](README.ko.md)

Electron shell that packages the Movie Desk web app as a native macOS
application. The web bundle (Next.js static export from `apps/web`) is
served via a custom `app://` protocol so Service Worker registration and
SharedArrayBuffer (COOP/COEP) keep working inside the desktop window.

## Architecture

```
electron main (src/main.cjs)
 ├─ app:// protocol handler  → serves apps/web/out/** with COOP/COEP headers
 ├─ session header injector  → mirrors COOP/COEP onto http://localhost (dev)
 ├─ BrowserWindow            → loads the compatibility origin `app://cut-editor/editor/`
 └─ native menu              → forwards File/Edit/View commands via preload
```

The preload (`src/preload.cjs`) translates IPC messages from native menu
items into `window.dispatchEvent(new CustomEvent("movie-desk:menu-export"))` etc.
The web app can listen for these events to react to native menu clicks.

## Dev workflow

```bash
pnpm --filter @movie-desk/desktop install      # one-time
pnpm --filter @movie-desk/desktop dev          # boots next dev + electron together
```

`dev` launches `pnpm --filter @movie-desk/web dev` and, once `http://localhost:3000/editor`
is reachable, opens an Electron window pointed at it. DevTools open in
a detached pane.

## Packaging a `.dmg`

```bash
pnpm --filter @movie-desk/desktop build:mac          # universal (arm64 + x64)
pnpm --filter @movie-desk/desktop build:mac:arm64    # Apple silicon only
pnpm --filter @movie-desk/desktop build:mac:x64      # Intel only
```

The script:

1. Runs `NEXT_OUTPUT=export next build` in `apps/web/`, producing
   `apps/web/out/` (static HTML + JS + media assets).
2. Invokes `electron-builder --mac` which assembles a `.app` bundle and
   wraps it in a `.dmg`. Output lands in `apps/desktop/dist/`.

`build:web` runs `prebundle:models` first. The static export includes MediaPipe
wasm, Selfie Segmenter, a checksum-verified Face Landmarker, and the Whisper
transcription model, so analysis and transcription work offline from first
launch. Packaged `app://` runs do not silently fetch a missing model from a CDN.

## Code signing & notarisation

Hardened runtime is on by default in `electron-builder.yml`.

**Unsigned build (default)** — runs out of the box. A locally-built `.app`
opens directly on the same machine (no quarantine attribute). When users
download it from a GitHub Release, macOS attaches
`com.apple.quarantine` and shows a misleading **"…is damaged and can't be
opened"** dialog that right-click → Open won't bypass. They (or you) have
to strip it once:

```bash
xattr -cr "/Applications/Movie Desk.app"
```

```yaml
# electron-builder.yml currently ships with:
mac:
  identity: null      # remove this line once you have a Developer ID
```

**Signed + notarised build** — requires an Apple Developer ID Application
certificate. Remove `identity: null` from `electron-builder.yml`, then
export the env vars before running the build:

```bash
export CSC_LINK=/path/to/DeveloperID.p12
export CSC_KEY_PASSWORD='...'
export APPLE_ID='you@example.com'
export APPLE_APP_SPECIFIC_PASSWORD='abcd-efgh-ijkl-mnop'
export APPLE_TEAM_ID='ABCDE12345'
pnpm --filter @movie-desk/desktop build:mac
```

electron-builder picks them up automatically and runs `notarytool` on the
resulting `.dmg`. The output is Gatekeeper-clean for distribution.

## Releasing through GitHub Actions

A release workflow lives at
[`.github/workflows/release.yml`](../../.github/workflows/release.yml). It
fires only on:

- a `v*` tag push (`git tag v0.1.1 && git push --tags`), or
- a manual **Run workflow** click on the GitHub Actions page.

Both paths run `pnpm --filter @movie-desk/desktop release:mac` on a macOS runner,
which builds the static web export, packages arm64 + x64 `.dmg`s, and
uploads them to a GitHub Release that matches the version in this
package's `package.json`. `latest-mac.yml` is written too so
`electron-updater` can find the new build.

Bump this package's `version` field before pushing the tag — electron-builder
uses that number to name the Release.

## What's next

- Universal Mac App Store build (separate target in electron-builder).
- Signing + notarisation in CI (add `CSC_*` / `APPLE_*` secrets and remove
  `identity: null`).
- Filesystem-reference local library and validation of the macOS codec path.
