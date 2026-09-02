# Movie Desk 작업 순서

갱신 2026-09-02 · 상위 문서 [`06-master-plan.md`](06-master-plan.md) · 지침
[`../CLAUDE.md`](../CLAUDE.md)

이 문서는 마스터플랜의 Phase를 **실제로 착수할 수 있는 배치**로 쪼갠 것이다. 배치는
위에서 아래로 진행하고, 한 배치는 구현·테스트·실제 화면 확인·문서·커밋을 한 단위로
닫는다. 배치가 끝나면 맨 아래 상태 표를 갱신한다.

## 읽는 법

- **B#** = 배치. 브랜치 하나, 커밋 몇 개 규모. 크기는 S(반나절~하루) · M(2~4일) · L(1~2주).
- **D#** = 코드보다 먼저 사용자가 정해야 하는 결정. 결정 전에는 해당 배치를 열지 않는다.
- **M#** = 마일스톤. 마스터플랜의 Phase와 1:1로 대응한다.
- 도그푸딩에서 나온 P0(완주 불가·손실)는 어떤 배치보다 먼저 처리한다.

## 역할 분담 (Claude · Codex · 사용자)

두 에이전트가 같은 저장소에서 일한다. 충돌을 피하는 규칙은 세 가지다. **영역으로
나누고, 서로 다른 작업 트리에서 일하고, main에는 게이트를 통과한 것만 fast-forward로
넣는다.**

### 담당

| 담당 | 배치 | 소유 영역 |
| --- | --- | --- |
| **Claude** (파이프라인·신뢰성·통합) | B1 CI 복구, B2 버전 정책·포맷 게이트, B3 통합, B5 RC 빌드 준비, B11 HEVC·.mov·회전, B15 분석 디코더 공유, B17 자동 편집 E2E, B22 회귀 자동화, B23 muxer 교체, B24 체크리스트 자동화 | `apps/web/src/renderer/`, `export/`, `persistence/`, `media/import.ts` `probe.ts` `organize.ts`, `apps/web/e2e/`, `.github/`, `scripts/`, 루트 `package.json`·`pnpm-lock.yaml`·`knip.json`·`biome.json`, `packages/core/` |
| **Codex** (제품 UI·안내·문서·데스크톱 셸) | D1·D3 아키텍처 보충안(`docs/spikes/`, 카탈로그·재연결 설계), HEIC 스파이크, B4 첫 실행 오프라인, B6 도그푸딩 템플릿, B9 실패 안내 UI, B10 HEIC(데스크톱 변환 + UI), B12 Live Photo·폴더, B13 리포트 문구, B14 컷 이유, B16 시나리오·가중, B18 카드 템플릿, B19 한국어 Whisper 평가, B20 공유 프리셋, B21 내보내기 이후 화면 | `apps/web/src/autoedit/`, `music/`, `editor/`, `app/`, `i18n/`, `subtitles/`, `preview/`, `timeline/components/`, `apps/web/src/app/globals.css`·`tailwind.config.ts`, `apps/desktop/src/`, `docs/00` `01` `06`, README 두 언어, 랜딩 |
| **사용자** | D1~D4 결정, B7 도그푸딩 실행, B8 P0 배정, 릴리스 태그·푸시 승인 | |

knip 미사용 export 정리는 파일 소유자가 각자 한다. 자동 편집·음악 쪽 8건은 Codex,
`stores/` 1건은 Claude.

### 함께 쓰는 파일의 규칙

- `i18n/messages.ko.ts`·`messages.en.ts`: 추가만 한다. 자기 배치의 키를 한 블록으로
  붙이고 남의 키를 옮기지 않는다.
- `media/components/media-bin.tsx`: 정렬·묶기 로직은 Claude, 스타일·문구는 Codex.
  구조를 바꾸기 전에 아래 인계 메모에 한 줄 남긴다.
- `apps/web/package.json` 의존성: Claude가 관리한다. Codex가 의존성을 더해야 하면
  인계 메모에 이유를 적고 진행한다.
- `docs/07-work-order.md`: 상태 표에서 자기 행만 고친다.
- 포맷: `biome format`은 게이트에 넣지 않는다. 각 배치는 자기가 만들거나 고친 파일만
  포맷한다. 루트 `scripts/`만 `biome check`로 게이트한다. 전면 포맷 커밋은 양쪽에 열린
  브랜치가 없는 통합 직후에 Claude가 한 번 한다.

### 작업 트리와 통합

- Codex는 `code_work/movie_desk`(기존 체크아웃)에서 `codex/<배치>` 브랜치로 일한다.
- Claude는 `code_work/movie_desk-claude` 워크트리에서 `claude/<배치>` 브랜치로 일한다.
  같은 `.git`을 공유하므로 서로의 커밋이 바로 보인다.
- 배치를 닫을 때: `git fetch` → `origin/main` 위로 rebase → `pnpm lint && pnpm typecheck
  && pnpm test && pnpm test:e2e && pnpm audit:prod` 통과 → 브랜치를 남기고 **사용자에게
  통합 요청**. **merge·tag·push는 사용자 확인 없이 하지 않는다.** 통합은 fast-forward만,
  merge 커밋은 만들지 않는다.
- B10·B11 구현 전에는 두 에이전트가 설계(스파이크 결과)를 서로 교환한 뒤 시작한다.
- 상대 체크아웃의 작업 트리는 건드리지 않는다. `git add -A`는 자기 워크트리에서만.
- 배치 시작 전 `git pull --ff-only origin main`으로 최신 main을 가져온다.

### 인계 메모

- 2026-09-03 Claude: Electron `nativeImage`도 HEIC를 못 읽는다(`isEmpty`). Codex의 ImageIO
  경계 결론이 유효하다. D1 보충안 검토: `read(start,length)`는 현재 `mp4-decoder.ts`의
  `readChunk(blob.slice)`와 1:1이라 충돌 없음. 오디오 엔진은 전체 파일을 `decodeAudioData`에
  넘기므로 오디오 프록시 캐시 variant가 필요. 자세한 내용은
  `docs/decisions/2026-09-03-local-media-storage.review.md`(`claude/d1-review`).
- 2026-09-03 Claude: HEVC·.mov·회전 스파이크 완료(`docs/spikes/2026-09-03-hevc-mov.md`).
  Electron·Chrome은 fixture의 `<video>` 재생과 WebCodecs codec capability가 모두 OK이고
  `<video>`는 회전 matrix를 반영한다. WebCodecs 실제 프레임 디코드·demux·회전과 실제 iPhone
  HDR/VFR은 B11 게이트 전 미확정. CI Chromium은 HEVC 불가. B11 설계안을 같은 문서에
  적었으니 Codex의 HEIC 스파이크와 교환하자.
- 2026-09-03 Codex: B4를 `codex/b4-offline`에서 진행 중. additive로 `apps/web/package.json`
  (prebundle:mediapipe/models 스크립트), `apps/desktop/package.json`(build:web 사전 번들),
  `release.yml`(prebundle:models 호출)을 건드림. smile.ts의 조용한 CDN 폴백 제거, app://
  Whisper 원격 폴백 차단 포함.
- 2026-09-03 Claude: 위 세 파일은 B4가 main에 들어갈 때까지 건드리지 않는다. B17 e2e는
  얼굴 모델이 없을 때 `scoreSmiles`가 null을 돌려주고 분석이 계속되는 계약에 기댄다.
  B4에서 그 계약을 유지해 주면 CI에 모델 번들 없이도 e2e가 통과한다. CI에 prebundle을
  넣고 싶으면 `ci.yml`은 Claude가 맡는다.
- 2026-09-03 사용자: 이 앱은 전적으로 Photo Desk 같은 macOS 로컬 앱이다. 저장 위치는 큰 문제가 아니다. → D1·D3 결정, 문서 반영.
- 2026-09-03 Claude: B1 완료 후 계획된 B3대로 main을 fast-forward하고 푸시했다
  (origin/main = 37872b3). Codex의 "확인 없이 merge·tag·push 금지" 제안이 그 직후
  도착했고, 이후로는 그 규칙을 따른다. Codex는 `git checkout main && git pull --ff-only`로
  옮겨 오면 된다.
- 2026-09-03 Codex: D1은 파일 참조 + SQLite 카탈로그, 사용자 메타데이터 분리, fingerprint
  기반 재연결. D3는 capability spike 먼저. M4 앞에 수동 편집·라이브러리 안전·내보내기
  완주 게이트. 추정치는 잠정. Codex는 B4·B6·D1/D3 보충안 담당, package/lockfile/자동 편집
  E2E는 건드리지 않음.

## 마스터플랜 검토에서 나온 조정 사항

마스터플랜은 방향·게이트·지표가 분명하다. 배치로 쪼개면서 아래 네 가지를 보탰다.

1. **저장 모델 결정을 앞당긴다.** 지금 앱은 모든 원본을 브라우저 OPFS에 **복사**한다.
   마스터플랜의 라이브러리 축(수백~수천 자산, 프로젝트 간 재사용, 원본 위치 이해)과
   Photo Desk의 방식(디스크 위 실제 파일 + 인덱스)은 복사 모델과 맞지 않는다. 4K
   클립 1,000개를 OPFS에 복제할 수는 없다. 이 결정(D1)은 Phase 6가 아니라 원본 호환
   작업(M3) 전에 내려야 가져오기 경로를 두 번 만들지 않는다.
2. **"세 축 동등"을 순서 규칙으로 바꾼다.** 한 사람이 세 제품을 동시에 키울 수는
   없다. v0.4.0 이후에는 라이브러리·편집·안내 트랙에서 배치를 하나씩 번갈아 연다.
3. **측정을 도그푸딩 전에 정의한다.** 초안 유지율·가져오기 성공률·초안 생성 시간은
   1회차에서는 손으로 세되, 세는 방법을 템플릿에 먼저 적는다.
4. **HEIC·HEVC 처리 위치를 결정으로 뺀다.** 데스크톱(macOS 내장 디코더)과 웹(wasm)
   중 어디를 먼저 지원할지에 따라 M3의 크기가 두 배 차이 난다(D3).

## 먼저 정할 것

| 결정 | 내용 | 권장안 | 막히는 배치 |
| --- | --- | --- | --- |
| D1 저장 모델 | **결정(사용자, 2026-09-03): Movie Desk는 Photo Desk처럼 macOS 기반 로컬 앱이다.** 편집 결과물을 어디에 저장하느냐는 큰 문제가 아니다. 따라서 브라우저 OPFS 한계에 맞춰 설계하지 않는다. 남은 세부: 라이브러리 원본을 디스크 참조 + 인덱스로 둘지(권장), 웹 빌드는 개발·미리보기용으로만 유지할지 | 데스크톱(Electron) 우선. 라이브러리는 디스크 원본 참조 + SQLite 카탈로그, OPFS는 기존 웹 프로젝트 호환과 캐시(프록시·썸네일)로 제한. 사용자 메타데이터(태그·평점·컬렉션)는 재생성 가능한 인덱스와 **분리해 백업·내보내기 가능**하게 두고, 자산 식별자는 경로만이 아니라 **volume/path/size/mtime/content fingerprint**와 재연결 전략을 포함한다(Codex 검토 반영). Photo Desk의 NAS 경로 계약에 합류 | Track A |
| D2 버전 정책 | **결정(Codex 제안, Claude 동의, 사용자 확인 대기):** `apps/desktop/package.json`이 canonical release version. `scripts/check-versions.mjs`가 root/web/core를 검증하고 `pnpm sync:versions`로 맞춘다. Changesets는 공개 배포·다중 패키지 릴리스 전까지 보류 | 적용됨 (B2) | B2, B5 |
| D3 HEIC·HEVC 처리 위치 | **D1에 따라 데스크톱 먼저.** 단 "내장 디코더라 의존성 0"으로 확정하지 않는다. Electron/Chromium이 macOS 디코더를 어떤 경로로 쓸 수 있는지 **HEIC·HEVC·MOV fixture로 capability spike**를 먼저 하고, 결과에 따라 직접 재생 / 네이티브 Swift helper / 프록시 변환 중 하나로 경로를 고정한다. 원본 메타데이터 보존을 게이트에 넣는다(Codex 검토 반영) | 스파이크 결과가 정한다. 스파이크: HEVC·MOV는 Claude, HEIC는 Codex, 결과는 `docs/spikes/`에 | B10, B11 |
| D4 이름 | Movie Desk 유지 여부 | CLAUDE.md대로 개인 단계에서는 유지, 공개 전 정식 조사 | Phase 7 |

## M1 — 안전한 기준선 (Phase 0, 합계 S~M)

| 배치 | 크기 | 내용 | 완료 게이트 |
| --- | --- | --- | --- |
| B1 CI 복구 | S | 루트 `pnpm.overrides`의 postcss·nanoid를 OSV 수정 버전으로 올리고 `pnpm audit:prod` 통과 | 로컬 audit 녹색 |
| B2 정리 커밋 | S | knip 10건 제거, 포맷 전용 커밋 1개(biome 전면 적용) 또는 게이트에서 format 제외 명시, D2 적용 | lint·knip 녹색, 동작 변경 없음 |
| B3 통합 | S | `feat/identity`를 main에 통합(fast-forward), 푸시, 원격 CI 확인 | origin/main CI 전체 녹색 |
| B4 첫 실행 오프라인 | M | Whisper 프리번들이 릴리스에 실제 포함되는지, FaceLandmarker 모델을 번들할지 다운로드 안내로 갈지 정하고 구현. 새 프로필에서 오프라인 첫 실행 확인 | 오프라인 첫 실행이 동작하거나 정직하게 안내 |
| B5 v0.4.0-rc.1 | S | RC 태그, arm64·x64 DMG, 설치·아이콘·배경·업데이트 확인·`cut_editor` 시절 데이터 열기 | RC가 두 아키텍처에서 실행되고 기존 데이터를 연다 |

## M2 — 한 편 완주 (Phase 1, 합계 M)

| 배치 | 크기 | 내용 | 완료 게이트 |
| --- | --- | --- | --- |
| B6 도그푸딩 준비 | S | `docs/dogfood/TEMPLATE.md`(기기, 파일 구성, 시간, 막힘, P0/P1/P2, 지표 세는 법). 촬영본 세트 선정: 50~200개, HEIC·HEVC·.mov·세로·사진·음악을 일부러 섞는다 | 템플릿과 세트 목록 |
| B7 도그푸딩 1회차 | M | 가져오기 → 정리 → 리포트 → 모드 → 초안 → 채택/제외 → 마무리 → 내보내기 → 가족 전송을 중단 없이. `docs/dogfood/2026-09-xx.md` 기록 | 3~5분 완성본 1편 전송, P0/P1 목록, 지표 기준선 |
| B8 P0 수정 | S~M | 완주를 막은 문제만 고치고 막힌 단계를 다시 밟는다 | P0 = 0 |

## M3 — 원본 그대로 받기 (Phase 2, 합계 M~L) · D1·D3 결정 후

B7의 P0/P1 순서가 우선이다. 아래는 기본 순서다.

| 배치 | 크기 | 내용 | 완료 게이트 |
| --- | --- | --- | --- |
| B9 실패 격리와 안내 | S | 파일별 실패 이유(코덱 미지원·손상·저장 공간)를 구분해 안내, 한 파일 실패가 일괄 가져오기를 멈추지 않게, 호환 표 문서 | 실패 파일이 있어도 나머지가 들어온다 |
| B10 HEIC/HEIF | M | D3에 따라 썸네일·프레임 디코드, EXIF 촬영 시각·위치 유지, 소형 fixture를 CI에 | 아이폰 HEIC가 변환 없이 들어온다 |
| B11 HEVC·.mov·회전 | M | Electron과 Chrome에서 WebCodecs HEVC 지원 확인 스파이크 → 재생·분석·내보내기 경로, 미지원 시 안내, 회전 메타 반영, fixture | HEVC .mov가 재생·분석·내보내기된다 |
| B12 Live Photo·폴더 | S~M | Live Photo 정지/영상 쌍 처리, 폴더 드래그 재귀, DCIM 구조 | 폴더째 넣어도 빠짐없이 들어온다 |

게이트: 기준 세트 전 파일이 들어오거나 파일별 해결 안내가 나온다.

## M4 — 초안 품질과 속도 (Phase 3, 합계 L)

**선행 게이트(Codex 검토 반영):** M4에 들어가기 전에 수동 편집 완주, 라이브러리 안전(원본 무손상·복구), 내보내기 완주가 도그푸딩에서 확인돼야 한다. 자동 초안 품질은 그 뒤다. 제품 목표가 다시 AI 중심으로 기울지 않게 하는 장치다. B17은 새 자동 기능이 아니라 **기존 기능 보호용 회귀 E2E**다.

| 배치 | 크기 | 내용 | 완료 게이트 |
| --- | --- | --- | --- |
| B13 리포트 문구 | S~M | 비전문가 언어로 재작성. "무엇이 있고 어떤 영상이 가능한지"를 수치보다 먼저 | 도그푸딩 참가자가 설명 없이 이해 |
| B14 컷 이유 한 줄 | M | 채택·탈락 카드에 얼굴·흔들림·노출·중복·골든아워·이야기 위치 이유 | 모든 자동 결정에 이유 |
| B15 분석 디코더 공유 | M~L | 장면 감지·모션 추적을 WebCodecs 디코더 공유로, 진행률·취소·재개 | 동일 fixture에서 분석 시간 단축 수치 기록 |
| B16 고정 시나리오 | M | 사진+영상 혼합, 무음악, 짧은 소스, 중복 많은 소스 시나리오와 성장 기록 가중 조정 | 시나리오 4종 통과 |
| B17 자동 편집 E2E | M | ffmpeg 태그 클립 fixture로 추천 → 초안 → 실행취소 1회를 Playwright로 | CI가 자동 편집 여정을 지킨다 |

게이트: 도그푸딩 2회차 초안 유지율 60% 이상.

## M5 — 마무리와 공유 (Phase 4, 합계 M)

| 배치 | 크기 | 내용 | 완료 게이트 |
| --- | --- | --- | --- |
| B18 카드 템플릿 | M | 여행·성장 제목·챕터 카드 2~3종, 한글 폰트 프리셋 | 템플릿으로 제목·챕터 완성 |
| B19 한국어 Whisper | M | 한국어 모델 품질·크기·속도 비교, 데스크톱 번들 정책 | 한국어 자막이 쓸 만함 |
| B20 공유 프리셋 | S~M | 가족 메신저(용량)·YouTube·TV/태블릿 프리셋, 실제 재생기 검증 | 목표 기기에서 영상·스테레오·자막 재생 |
| B21 내보내기 이후 | M | 완료 화면(파일 위치·다시 내보내기·공유), 백업/복원과 누락 미디어 복구 안내 | 다른 도구 없이 전송 |

## M6 — v0.4.0 안정판 (Phase 5, 합계 M)

| 배치 | 크기 | 내용 | 완료 게이트 |
| --- | --- | --- | --- |
| B22 회귀 자동화 | M | 내보내기 스모크, 취소, 복원을 Playwright 또는 fixture로 | CI 녹색 |
| B23 muxer 교체 | M | `mp4-muxer`를 유지보수되는 후속으로, MP4·오디오·프록시·지도 전환 출력 비교 | 출력 동일성 확인 |
| B24 릴리스 체크리스트 | M | 충돌 복구·저장 공간 부족·손상 프로젝트·누락 미디어 점검, 두 번째 촬영본 세트 완주 | 두 세트 완주, 손실 0 |
| B25 v0.4.0 | S | 태그·릴리스·업데이트 안내 확인 | Movie Desk 이름의 첫 안정판 |

## 이후 — 세 축 성숙 (Phase 6) · 진입 조건: v0.4.0 + D1

트랙마다 한 번에 배치 하나만 열고, A → B → C 순으로 번갈아 연다. 이것이
"세 축 동등"을 한 사람이 지키는 방법이다. **예외:** 완주를 막는 위험과 여러 트랙이
기대는 공통 기반(저장 모델, 디코더, 인덱스)은 순환보다 먼저 한다(Codex 검토 반영).

| 트랙 | 첫 배치부터 순서 |
| --- | --- |
| A 라이브러리 | A1 참조 가져오기 + 인덱스(D1) → A2 메타데이터 인덱스·복합 검색 → A3 컬렉션·태그·평점·스마트 필터 → A4 누락 재연결·휴지통 → A5 1,000개 성능 측정 |
| B 전문 편집 | B'1 프레임·수치 정밀 입력 감사 → B'2 피치 보존 속도 → B'3 오디오 미터·버스 → B'4 컬러 관리·스코프 → B'5 중첩 시퀀스([`NESTED_SEQUENCE_PLAN.md`](NESTED_SEQUENCE_PLAN.md) 재검토) → B'6 프록시·캐시·워커 측정 |
| C 안내 | C1 새 프로젝트 출발점 화면 → C2 빈·선택·오류 상태 설명 → C3 첫 완성률 측정 |

## 대략의 기간

**잠정치다.** 커밋 수 기반 추정이라 근거가 약하다. B1과 첫 도그푸딩(B7)의 실측 뒤에 다시 추정한다(Codex 검토 반영).

| 마일스톤 | 누적 |
| --- | --- |
| M1 기준선 | 1주 |
| M2 완주 | 2~3주 |
| M3 원본 | 5~6주 |
| M4 품질 | 9~11주 |
| M5 공유 | 11~13주 |
| M6 v0.4.0 | 13~15주 |

## 주차장

WebGPU, 렌더 워커, 백그라운드 렌더 큐, 모바일 네이티브 셸, 영어 랜딩·온보딩,
서명·공증. 성능·전문 작업 검증이나 사용자 발생 같은 조건이 채워지면 꺼낸다.

## 상태

| 배치 | 담당 | 상태 | 비고 |
| --- | --- | --- | --- |
| D1~D4 | 사용자 | D1·D3·D4 결정, D2 적용(확인 대기) | D1 세부: `docs/decisions/2026-09-03-local-media-storage.md` (Codex, Claude 검토 중) |
| B1 CI 복구 | Claude | 완료 | postcss 8.5.23, nanoid 3.3.18/5.1.16 · audit 0건 |
| B2 정책·포맷 | Claude | 완료, 통합 대기 | `claude/b2-version-policy` · check-versions 스크립트+테스트, CI 단계, 루트 scripts는 `biome check` 게이트, knip stores 1건. 전면 포맷은 아래 규칙 |
| B3 통합 | Claude | 완료 | feat/identity + B1을 main에 fast-forward, 푸시 (2026-09-03) |
| B4 첫 실행 오프라인 | Codex | 구현·번들 스모크 완료 | arm64/x64 DMG에 MediaPipe·Whisper 포함, DNS 차단 새 프로필 기동 확인. RC 수동 기능 검증은 B5에서 반복 |
| B5 RC | Claude 준비 · 사용자 태그 | 대기 | |
| B6 도그푸딩 템플릿 | Codex | 대기 | |
| B7 도그푸딩 1회차 | 사용자 | 대기 | |
| B8 P0 수정 | 배정 | 대기 | 영역별 |
| B9 실패 안내 | Codex | 대기 | |
| B10 HEIC | Codex | 대기 | 스파이크(Codex) 뒤, Claude와 설계 교환 |
| B11 HEVC·.mov·회전 | Claude | 스파이크 완료, 설계 교환 대기 | `claude/spike-hevc` · `docs/spikes/2026-09-03-hevc-mov.md`: Electron·Chrome ✅(미디어 요소·capability), CI Chromium ❌, 실제 iPhone·WebCodecs demux/회전은 미확정 |
| B12 Live Photo·폴더 | Codex | 대기 | |
| B13~B14 리포트·컷 이유 | Codex | 대기 | |
| B15 분석 디코더 공유 | Claude | 대기 | |
| B16 시나리오 | Codex | 대기 | |
| B17 자동 편집 E2E | Claude | 완료, 통합 대기 | `claude/b17-autoedit-e2e` · 기존 기능 보호용 회귀 테스트, e2e 9개 통과 |
| B18~B21 마무리·공유 | Codex | 대기 | |
| B22 회귀 자동화 | Claude | 대기 | |
| B23 muxer 교체 | Claude | 대기 | |
| B24 체크리스트 | Claude 자동화 · 사용자 완주 | 대기 | |
| B25 v0.4.0 | 사용자 | 대기 | |
