# AI subsystem

AI and analysis features run locally and turn their results into ordinary,
undoable project edits. The packaged macOS app bundles Whisper and MediaPipe
models before release; the optional semantic model is downloaded only after the
user enables it. Media never leaves the device.

## Current modules

- `transcribe.ts` — Whisper transcription through
  `@huggingface/transformers`; the UI maps source timestamps back to the clip.
- `silence-detect.ts` + `auto-cut.ts` — WebAudio RMS analysis and reversible
  timeline cuts.
- `scene-detect.ts` + `apply-scene-cuts.ts` — histogram comparison and scene
  boundary splits.
- `bg-remove.ts` — MediaPipe segmentation used by the compositor's
  background-removal pass. The compositor caches masks at unchanged source
  times.
- `motion-track.ts` + `apply-motion-track.ts` — local template matching that
  writes transform keyframes.
- `beat-detect.ts` — local onset analysis that creates timeline markers.
- `auto-white-balance.ts` — frame sampling that writes white-balance effect
  parameters.
- `subtitles-to-clips.ts` — converts transcript segments into editable text
  clips.

## Constraints and next work

- Background footage analysis surfaces progress plus stop/resume controls in
  the auto-edit panel. Cancellation is not yet consistently available across
  every standalone tool in `ai-panel.tsx`.
- Scene and motion analysis seek media elements serially. Sharing the preview
  WebCodecs decoder is the main performance opportunity.
- Translation, smart reframe, color matching across clips, and stem isolation
  are product backlog items, not implemented modules.
- The bundled Whisper model is multilingual `whisper-base` q8. The AI panel
  requires an explicit Korean/English speech-language choice so the runtime
  never silently defaults to English or translates Korean speech.
- Whisper's matching ONNX Web runtime is also bundled; neither model loading
  nor inference depends on a CDN. Transformers.js stays pinned to 3.8.1 until
  the newer runtime can open the current q8 decoder graph reliably.
- `model-policy.ts` prevents packaged `app://` builds from silently falling back
  to a remote Whisper model. Face analysis always uses its bundled local path.
