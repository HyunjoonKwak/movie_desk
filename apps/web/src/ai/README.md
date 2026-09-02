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

- Long tasks surface progress in `ai-panel.tsx`; cancellation is not yet
  consistently available across every task.
- Scene and motion analysis seek media elements serially. Sharing the preview
  WebCodecs decoder is the main performance opportunity.
- Translation, smart reframe, color matching across clips, and stem isolation
  are product backlog items, not implemented modules.
- The bundled Whisper model is English (`whisper-tiny.en`); do not describe the
  current transcription path as multilingual.
- `model-policy.ts` prevents packaged `app://` builds from silently falling back
  to a remote Whisper model. Face analysis always uses its bundled local path.
