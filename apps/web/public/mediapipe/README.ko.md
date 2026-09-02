# MediaPipe 동봉 자산

[English](README.md) · **한국어**

MediaPipe Tasks Vision 런타임과 Selfie Segmenter·Face Landmarker 모델의 로컬
사본입니다. 배경 제거와 얼굴 기반 분석이 완전 오프라인으로 동작하도록(런타임 시점에
`cdn.jsdelivr.net`이나 `storage.googleapis.com`에 접속하지 않도록) 여기에
포함하며, Electron 데스크톱 번들에 그대로 동봉됩니다.

## 구조

```
mediapipe/
├── wasm/
│   ├── vision_wasm_internal.{js,wasm}
│   ├── vision_wasm_module_internal.{js,wasm}
│   └── vision_wasm_nosimd_internal.{js,wasm}
└── models/
    ├── selfie_segmenter.tflite       # ~244 KB, 저장소에 포함
    └── face_landmarker.task          # ~3.6 MB, 데스크톱 빌드 전에 받음
```

## 갱신 방법

원본 출처:

- **wasm 런타임** → `node_modules/@mediapipe/tasks-vision/wasm/`
  (설치된 `@mediapipe/tasks-vision` 버전 기준 — 현재 `apps/web/package.json`의
  `0.10.35`).
- **selfie_segmenter.tflite** →
  `https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite`
- **face_landmarker.task** → 버전과 체크섬을 고정한
  `apps/web/scripts/download-mediapipe-models.mjs`가 내려받음.

`@mediapipe/tasks-vision` 업그레이드 후 갱신:

```bash
pnpm install
cp node_modules/.pnpm/@mediapipe+tasks-vision@*/node_modules/@mediapipe/tasks-vision/wasm/* \
   apps/web/public/mediapipe/wasm/
curl -sSL -o apps/web/public/mediapipe/models/selfie_segmenter.tflite \
   https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite
pnpm --filter @movie-desk/web prebundle:mediapipe
```

`apps/web/src/ai/bg-remove.ts`의 로더는
`FilesetResolver.forVisionTasks("/mediapipe/wasm")` 및
`baseOptions.modelAssetPath: "/mediapipe/models/selfie_segmenter.tflite"`
경로로 이 파일들을 읽습니다. 얼굴 분석은
`/mediapipe/models/face_landmarker.task`만 사용하며 런타임 CDN 폴백이 없습니다.

## 라이선스

wasm 런타임과 Selfie Segmenter 모델 모두 Google이 **Apache License 2.0**으로
배포합니다. 런타임 라이선스는
[MediaPipe license](https://github.com/google-ai-edge/mediapipe/blob/master/LICENSE)
를, 모델 가중치 라이선스는 위 모델 URL 상의 모델 카드를 참조하세요.
