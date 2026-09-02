# Movie Desk

[English](README.md) · **한국어**

**Movie Desk는 편집을 몰라도 시작할 수 있는 로컬 우선 AI 영상 편집기입니다.**
찍어만 두고 쌓인 영상을 넣으면 촬영 시간과 장소로 정리하고, 영상의 방향을 제안하고,
초안까지 만듭니다. 그 위에서 내가 결정하고 마무리하며 영상은 내 기기를 떠나지
않습니다. macOS용 빌드는 [Releases 페이지](../../releases/latest)에서 받을 수 있습니다.

저장소와 로컬 폴더 이름은 `movie_desk`입니다.
[OpenCut](https://github.com/OpenCut-app/OpenCut) 학습에서 출발했습니다
(오프라인 참고용으로 `reference/`에 클론, 빌드에 포함되지 않음). 이름 변경 전
프로젝트도 그대로 열 수 있도록 기존 로컬 저장 식별자는 호환용으로 유지합니다.

## 어디에 맞는 도구인가

벤치마크가 아니라 방향 비교입니다. 쌓인 영상을 두고 사람들이 실제로 쓰는 것은
사진 앱의 자동 추억과 템플릿 앱입니다. 이들은 네 곳에서 실패합니다. 내가 표시한
것을 무시하고, 왜 그 장면을 골랐는지 숨기고, 영상을 클라우드로 보내고, 정작
중요한 기능에 돈을 받습니다. Movie Desk는 그 네 가지의 반대편에서 출발합니다.

| | 사진 앱 자동 추억 (Google 포토, Apple 추억) | 템플릿 앱 (CapCut, GoPro Quik) | **Movie Desk** |
|--|:--:|:--:|:--:|
| 영상이 내 기기를 떠나지 않음 | 제품마다 다름 | 제품마다 다름 | ✅ 분석·모델·저장 전부 |
| 왜 그 장면을 골랐는지 보여 줌 | ❌ | ❌ | ✅ 컷마다 이유 |
| 꼭 넣기·빼기를 지키며 다시 조립 | ❌ | 일부 | ✅ 재조립, 실행취소 1회 |
| 탈락한 장면을 한 번에 되살림 | ❌ | ❌ | ✅ 탈락 후보 브라우저 |
| GPS·날짜로 이야기 구성 (일차, 장소, 이동) | 일부 | ❌ | ✅ 오프라인 지오코딩 |
| 음악: 찾기·크레딧·비트 맞춤 | 자동 | 라이브러리 | ✅ 안내형 흐름 + 무료 음원 가져오기 |
| 진짜 타임라인에서 마무리 (리플, 키프레임, LUT, 자막) | ❌ | 일부 | ✅ |
| 무료 오픈소스 | ❌ | ❌ | ✅ MIT |

Final Cut Pro와 CapCut은 마무리 단계의 기준선으로 남습니다. 타임라인·이펙트·
내보내기 비교는 [`docs/01-feature-matrix.md`](docs/01-feature-matrix.md),
기술 설계는 [`docs/02-architecture.md`](docs/02-architecture.md)를 참고하세요.

## 현재 동작하는 기능

| 레이어 | 기능 |
|--|--|
| 코어 모델 | 불변 Project / Track / Clip / Effect / Keyframe / Transition + 실행취소·다시실행 |
| 타임라인 | 멀티트랙, 마그네틱 스냅, 리플, 트림/분할/이동, 트랙 간 드래그, 핀치 줌 |
| 렌더러 | WebGL2 컴포지터, ping-pong FBO, 다중 패스 이펙트 체인, 키프레임 보간 |
| 이펙트 | GPU/오디오 이펙트 24종, 1D/3D `.cube` LUT, 벡터 마스크, 블렌드 모드, 배경 제거 |
| 텍스트 | Canvas2D 렌더 텍스트 클립(크기/색/배경 조절) + 전용 자막 트랙 |
| 미디어 | OPFS 기반 자산, 썸네일/필름스트립/파형 분석, 진행률·중단 지원 대량 드래그-드롭 입수, 촬영 시간순 정렬과 날짜·장소별 묶기(오프라인 지오코딩), 프록시, 썸네일 크기 조절, 마퀴 다중 선택, 사용/제외 지정, 자산별 사용 구간 지정 |
| AI (전부 로컬) | 자동 묵음 컷(WebAudio RMS), Whisper 자막(HuggingFace), 장면 감지(χ²), 배경 제거(MediaPipe Selfie), 미소 감지(FaceLandmarker), 선택형 시맨틱 태그/중복 제거(MobileCLIP) |
| 자동 편집 | 여행/풍경 영상용 6단계 마법사: 불량 컷 필터(흐림/노출/흔들림), 흥미도 스코어링, 비트 그리드 조립 + 포토 스택/Ken Burns, GPS·날짜 기반 스토리 챕터(오프라인 지오코딩), 지도 이동 클립 렌더링, YouTube 오디오 라이브러리/Suno 음악 플로우, 음악 교체 시 비트-스냅 재정렬 — 전용 AUTO 트랙에 실행취소 1회로 적용 |
| 내보내기 | WebCodecs H.264/VP9/AV1 + 스테레오 AAC, LUFS 정규화, 작업 구간, 4종 프리셋 |
| 영속화 | 검증된 프로젝트 라이브러리·스냅샷, Yjs/IndexedDB 상태, OPFS 미디어, 손상 복구 |
| 모바일 | 반응형 셸 + 드로어 패널 + 투핑거 핀치 줌 |

## 저장소 구조

```
apps/web/         Next.js 15 앱 (에디터 UI)
apps/desktop/     Electron 셸 (macOS .app/.dmg 패키징)
packages/core/    프레임워크 독립 프로젝트 모델, 편집 명령, 타임라인 알고리즘
docs/             정체성·아키텍처·설계 문서
reference/        학습용 OpenCut 클론 (gitignored)
```

## 빠른 시작

```bash
pnpm install
pnpm dev          # http://localhost:3000
```

요구사항: Node 20+, pnpm 9+.

### 브라우저 E2E 테스트

```bash
pnpm --filter @movie-desk/web exec playwright install chromium  # 최초 1회
pnpm test:e2e
```

테스트는 격리된 에디터 서버를 실행해 화면 진입, 새로고침 후 IndexedDB
프로젝트 복원, 타임라인 마퀴 선택을 검증합니다.

## macOS 앱으로 설치하기

Movie Desk는 PWA manifest + 서비스 워커를 동봉하므로 별도 도구 없이 독립
데스크톱 윈도우로 설치할 수 있습니다. 네이티브 앱이 필요하면
[Releases 페이지](../../releases/latest)에서 빌드된 `.dmg`를 받으세요.

**Safari (macOS 권장)**

1. 실행 중인 사이트(예: `https://your-host/editor`)를 Safari 17+에서 엽니다.
2. **파일 → Dock에 추가…**
3. 이름과 아이콘을 확인하고 추가를 클릭합니다.

브라우저 크롬 없는 독립 윈도우로 실행되며 별도 dock 항목을 가집니다. 동봉된
서비스 워커가 앱 셸을 캐시해 짧은 네트워크 단절에도 계속 편집할 수 있습니다.

**Chrome / Edge**

주소창의 설치 아이콘(⊕)을 클릭하거나 **파일 → 설치**를 선택해 Launchpad와
dock에 앱을 추가합니다.

메뉴·파일 다이얼로그·자동 업데이트를 갖춘 완전한 네이티브 `.app` 번들이
필요하면 [`apps/desktop/`](apps/desktop/)을 참고하세요.

### 동봉된 로컬 AI 모델

MediaPipe(배경 제거) wasm 런타임과 Selfie Segmenter 모델은
`apps/web/public/mediapipe/`에 포함되어 있어 배경 제거 기능은 완전 오프라인
동작합니다.

Whisper 자막 모델(~40 MB, `Xenova/whisper-tiny.en` q8 양자화)은 첫 사용 시
HuggingFace에서 다운로드되며, 이후 브라우저 HTTP 캐시에 보관됩니다. 첫 실행
시점부터 오프라인으로 동작시키려면(데스크톱 번들 등) 아래 스크립트를
실행하세요:

```bash
pnpm --filter @movie-desk/web prebundle:whisper
```

스크립트가 `apps/web/public/whisper/Xenova/whisper-tiny.en/`에 모델 파일 7개
(약 41 MB)를 채웁니다. 런타임이 `env.localModelPath`로 해당 경로를 먼저
확인하고, 파일이 없을 때만 HuggingFace로 폴백합니다. 해당 디렉토리는
gitignore되어 있으므로 새로운 체크아웃마다 또는 데스크톱 빌드 파이프라인 안에서
재실행하세요.

## 릴리스 빌드

릴리스 빌드는 매 push가 아니라 수동 트리거로만 동작합니다. 워크플로 정의는
[`.github/workflows/release.yml`](.github/workflows/release.yml)에 있습니다.

**태그 릴리스 (권장)**

```bash
# 1. apps/desktop/package.json 의 version 을 올립니다 (예: 0.2.2 → 0.2.3).
#    이어서 push 할 태그와 같은 숫자여야 합니다.

# 2. 버전 변경을 커밋.
git commit -am "chore: bump desktop to 0.2.3"
git push

# 3. 태그 push — 이 시점에 워크플로가 발화합니다.
git tag v0.2.3
git push --tags
```

약 15분 후 동일 이름의 GitHub Release 에 `.dmg` 두 개(`-arm64` / Intel)가
업로드됩니다.

설치된 앱은 실행 시(그리고 4시간마다, 또는 **Movie Desk → 업데이트 확인…**
메뉴로) Releases API를 확인해 새 버전이 있으면 다이얼로그를 띄웁니다 —
다운로드를 누르면 브라우저에서 아키텍처에 맞는 `.dmg`를 받습니다. 미서명
빌드는 자체 설치가 불가능하므로 설치는 기존처럼 Applications에 드래그하는
방식입니다.

**임시 빌드** — GitHub 리포지토리 → **Actions** → **Release** → **Run
workflow** 버튼. 현재 `apps/desktop/package.json` 의 version 값을 그대로
사용합니다.

`.dmg` 는 기본 미사이닝 상태로 생성됩니다(`electron-builder.yml` 의
`identity: null`). GitHub Release 에서 다운로드한 `.app` 은 macOS 가
`com.apple.quarantine` 속성을 자동으로 붙여 **"…손상되었기 때문에 열 수
없습니다"** 라는 거짓 메시지를 띄웁니다 — 우클릭 → 열기로도 우회되지
않습니다. 첫 실행 전에 속성을 제거해야 합니다:

```bash
xattr -cr "/Applications/Movie Desk.app"
```

별도 안내 없이 바로 열리는 사이닝 + 공증된 `.dmg` 를 만들려면 Apple
Developer Secret 5개 (`CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`,
`APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`)를 리포지토리 Secrets 에
추가하고 `identity: null` 줄을 제거하면 됩니다 — 워크플로 변경 불필요.

## 로드맵 (v0.2 이후)

- WebGPU 렌더러 (WGSL 셰이더)
- 컴파운드/네스티드 시퀀스
- 백그라운드 렌더 큐
- 언어별 자막 트랙과 번역 워크플로
- 이펙트 미리보기 썸네일과 GIF/이미지 시퀀스 내보내기
- Capacitor 모바일 네이티브 셸

### 보류 항목 (평가 완료, 미출시)

- **컴파운드/네스티드 시퀀스**. 클립 묶음을 재사용 가능한 서브-타임라인으로
  감싸는 기능. 재귀 렌더링(내부 시퀀스를 오프스크린 FBO로 렌더 후 부모
  클립의 소스로 샘플)과 `kind: "compound"` 신규 추가, 직렬화·실행취소
  처리가 필요. MVP(재생+편집)에 2~3일, 키프레임 전파 완전 지원까지는 더
  소요 예상.
- **백그라운드 렌더 큐**. 내보내기 파이프라인을 별도 Electron
  `BrowserWindow`/`utilityProcess`로 분리해 렌더 중에도 편집 가능하게
  만드는 기능. 현재 파이프라인은 메인 렌더러에서 동작(WebCodecs도 거기
  있음). 분리하려면 공유 OPFS 레이어와 IPC 인코더 브릿지가 필요 — 데스크톱
  번들 한정 2일 예상, 웹과 동등 기능까지 가려면 더 소요.
