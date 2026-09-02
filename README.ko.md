# Movie Desk

[English](README.md) · **한국어**

**Movie Desk는 영상 자산 관리와 전문가 수준의 편집을 하나로 제공하면서도,
처음 편집하는 사람에게 가져오기부터 완성까지의 길을 안내하는 로컬 우선 영상
작업대인 macOS 앱입니다.** 기능을 덜어 내서 쉽게 만드는 대신 좋은 기본값과 단계적 공개로
전문 기능을 이해하기 쉽게 만듭니다. 로컬 AI는 분석·검색·자막·추천·선택형 초안을
돕고, 결정과 정밀한 마무리는 사용자가 맡습니다. 영상은 내 기기를 떠나지 않습니다.
macOS용 빌드는 [Releases 페이지](../../releases/latest)에서 받을 수 있습니다.

저장소와 로컬 폴더 이름은 `movie_desk`입니다.
[OpenCut](https://github.com/OpenCut-app/OpenCut) 학습에서 출발했습니다
(오프라인 참고용으로 `reference/`에 클론, 빌드에 포함되지 않음). 이름 변경 전
프로젝트도 그대로 열 수 있도록 기존 로컬 저장 식별자는 호환용으로 유지합니다.

## 어디에 맞는 도구인가

Movie Desk는 세 종류의 제품을 동시에 기준으로 삼습니다. 사진·영상 관리 앱의 정리와
검색, 안내형 앱의 쉬운 시작, 전문 편집기의 깊이·정확도·성능입니다. 이 세 과정이
분리돼 사용자가 파일 관리자와 자동 편집 앱, 전문 편집기를 오가야 하는 문제를 하나의
로컬 작업 공간에서 해결합니다. 아래 표는 자동 보조 영역의 방향 비교이며 제품 전체의
범위를 뜻하지 않습니다.

| | 사진 앱 자동 추억 (Google 포토, Apple 추억) | 템플릿 앱 (CapCut, GoPro Quik) | **Movie Desk** |
|--|:--:|:--:|:--:|
| 영상이 내 기기를 떠나지 않음 | 제품마다 다름 | 제품마다 다름 | ✅ 미디어·분석·저장 로컬 |
| 왜 그 장면을 골랐는지 보여 줌 | ❌ | ❌ | ✅ 컷마다 이유 |
| 꼭 넣기·빼기를 지키며 다시 조립 | ❌ | 일부 | ✅ 재조립, 실행취소 1회 |
| 탈락한 장면을 한 번에 되살림 | ❌ | ❌ | ✅ 탈락 후보 브라우저 |
| GPS·날짜로 이야기 구성 (일차, 장소, 이동) | 일부 | ❌ | ✅ 오프라인 지오코딩 |
| 음악: 찾기·크레딧·비트 맞춤 | 자동 | 라이브러리 | ✅ 안내형 흐름 + 무료 음원 가져오기 |
| 진짜 타임라인에서 마무리 (리플, 키프레임, LUT, 자막) | ❌ | 일부 | ✅ |
| 무료 오픈소스 | ❌ | ❌ | ✅ MIT |

Final Cut Pro와 DaVinci Resolve는 편집 깊이·정확도·성능·신뢰성의 기준선입니다.
타임라인·이펙트·내보내기 비교는 [`docs/01-feature-matrix.md`](docs/01-feature-matrix.md),
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
| AI (로컬 실행) | 자동 묵음 컷(WebAudio RMS), Whisper 자막(HuggingFace), 장면 감지(χ²), 배경 제거(MediaPipe Selfie), 미소 감지(FaceLandmarker), 선택형 시맨틱 태그/중복 제거(MobileCLIP). 일부 모델은 최초 사용 전 내려받음 |
| 자동 편집 | 여행/풍경 영상용 6단계 마법사: 불량 컷 필터(흐림/노출/흔들림), 흥미도 스코어링, 비트 그리드 조립 + 포토 스택/Ken Burns, GPS·날짜 기반 스토리 챕터(오프라인 지오코딩), 지도 이동 클립 렌더링, YouTube 오디오 라이브러리/Suno 음악 플로우, 음악 교체 시 비트-스냅 재정렬 — 전용 AUTO 트랙에 실행취소 1회로 적용 |
| 내보내기 | WebCodecs H.264/VP9/AV1 + 스테레오 AAC, LUFS 정규화, 작업 구간, 4종 프리셋 |
| 영속화 | 검증된 프로젝트 라이브러리·스냅샷, Yjs/IndexedDB 상태, OPFS 미디어, 손상 복구 |
| 모바일 | 반응형 셸 + 드로어 패널 + 투핑거 핀치 줌 |

## 저장소 구조

```
apps/web/         Next.js 15 기반 에디터 UI·렌더러 (개발 미리보기 포함)
apps/desktop/     Electron 셸 (macOS .app/.dmg 패키징)
packages/core/    프레임워크 독립 프로젝트 모델, 편집 명령, 타임라인 알고리즘
docs/             정체성·아키텍처·설계 문서
reference/        학습용 OpenCut 클론 (gitignored)
```

## 개발 미리보기

```bash
pnpm install
pnpm dev          # 브라우저 개발 미리보기: http://localhost:3000
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

Movie Desk의 제품 배포 형태는 macOS 데스크톱 앱입니다. `apps/web`의 브라우저 실행은
개발과 자동 테스트를 위한 미리보기이며 별도 웹 서비스가 아닙니다. 설치본은
[Releases 페이지](../../releases/latest)의 `.dmg`를 사용하거나
[`apps/desktop/`](apps/desktop/) 안내에 따라 로컬에서 빌드합니다.

### 동봉된 로컬 AI 모델

데스크톱 빌드는 MediaPipe 런타임, Selfie Segmenter, Face Landmarker와 Whisper
자막 모델(~41MB, `Xenova/whisper-tiny.en` q8)을 먼저 준비해 앱에 동봉합니다.
패키징된 `app://` 실행에서는 모델 누락을 숨기기 위한 CDN 폴백을 허용하지 않습니다.
수동으로 모델만 준비하려면 다음 명령을 사용합니다.

```bash
pnpm --filter @movie-desk/web prebundle:models
```

이 명령은 Face Landmarker를 체크섬 검증하고 Whisper 모델 파일 7개를 로컬 public
경로에 채웁니다. 생성 자산은 gitignore되며 `apps/desktop`의 `build:web`과 릴리스
빌드가 자동으로 명령을 실행합니다. MobileCLIP 시맨틱 분석은 별도 선택 기능으로,
사용자가 켤 때만 약 55MB 모델 다운로드를 명시적으로 시작합니다.

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

## 로드맵

계획은 [`docs/06-master-plan.md`](docs/06-master-plan.md)에 있습니다. 단계는
0 CI·보안 복구와 Movie Desk 릴리스 후보, 1 실제 가족 촬영본 도그푸딩, 2 아이폰·
카메라 원본 그대로 받기(HEIC, HEVC, .mov), 3 초안 품질과 분석 속도, 4 마무리와
공유, 5 회귀 검증과 첫 안정판 `v0.4.0`, 6 라이브러리·전문 편집·안내의 제품 수준
성숙, 7 사용자가 생길 때 공개 확장입니다.

하지 않을 것: 실시간 팀 협업, 플러그인 마켓, 클라우드 계정·필수 업로드,
자동 편집만으로 끝나는 제품, 대량 숏폼 생성기.
