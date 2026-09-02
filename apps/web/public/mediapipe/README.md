# Vendored MediaPipe assets

**English** · [한국어](README.ko.md)

Local copies of the MediaPipe Tasks Vision runtime plus the Selfie Segmenter
and Face Landmarker models. Vendored here so background removal and face-based
analysis work fully offline (no
runtime hits to `cdn.jsdelivr.net` or `storage.googleapis.com`) and is
ready to ship inside the Electron bundle.

## Layout

```
mediapipe/
├── wasm/
│   ├── vision_wasm_internal.{js,wasm}
│   ├── vision_wasm_module_internal.{js,wasm}
│   └── vision_wasm_nosimd_internal.{js,wasm}
└── models/
    ├── selfie_segmenter.tflite       # ~244 KB, committed
    └── face_landmarker.task          # ~3.6 MB, fetched before desktop builds
```

## How to refresh

These files come from:

- **wasm runtime** → `node_modules/@mediapipe/tasks-vision/wasm/`
  (matches the installed `@mediapipe/tasks-vision` version — currently
  `0.10.35` per `apps/web/package.json`).
- **selfie_segmenter.tflite** →
  `https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite`
- **face_landmarker.task** → downloaded with a pinned version and checksum by
  `apps/web/scripts/download-mediapipe-models.mjs`.

To refresh after a `@mediapipe/tasks-vision` upgrade:

```bash
pnpm install
cp node_modules/.pnpm/@mediapipe+tasks-vision@*/node_modules/@mediapipe/tasks-vision/wasm/* \
   apps/web/public/mediapipe/wasm/
curl -sSL -o apps/web/public/mediapipe/models/selfie_segmenter.tflite \
   https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite
pnpm --filter @movie-desk/web prebundle:mediapipe
```

The loader in `apps/web/src/ai/bg-remove.ts` reads from these paths via
`FilesetResolver.forVisionTasks("/mediapipe/wasm")` and
`baseOptions.modelAssetPath: "/mediapipe/models/selfie_segmenter.tflite"`.
Face analysis only uses `/mediapipe/models/face_landmarker.task`; there is no
runtime CDN fallback.

## License

Both the wasm runtime and the Selfie Segmenter model are distributed by
Google under the **Apache License 2.0**. See
[MediaPipe license](https://github.com/google-ai-edge/mediapipe/blob/master/LICENSE)
for the runtime and the model card linked from the file URL above for the
model weights.
