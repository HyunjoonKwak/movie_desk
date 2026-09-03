# Movie Desk 작업 순서

갱신 2026-09-03 · 상위 문서 [`06-master-plan.md`](06-master-plan.md) · 지침
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

- 2026-09-03 Claude: B15 후속(프록시·썸네일 샘플러). 확인 중 미디어 GC 경쟁을 잡았다: 로드 3초 뒤
  `collectMediaGarbage`가 시작 시점 프로젝트 스냅샷으로 keep 집합을 만들고 라이브러리 전체를 읽는 동안
  끝난 가져오기의 파일(lease 해제 후, `addMediaAsset` 전)을 지웠다(31MB 가져오기에서 재현). GC가 삭제
  직전 현재 프로젝트를 다시 보도록 수정(`persistence/media-gc.ts`, getter 인자). Codex 확인 요청:
  `media/hooks.ts`가 배치 전체가 끝나기 전에 파일별 `releaseLease()`를 호출한다 — lease는 `addMediaAsset`
  이후에 풀어야 GC와 무관하게 안전하다.
- 2026-09-03 Claude: B23. mediabunny는 MPL-2.0(mp4-muxer는 MIT). 파일 단위 카피레프트라 번들에 넣는 것은
  문제없지만 라이브러리 파일을 수정하면 공개 의무가 생긴다 — 포크 금지 원칙만 지키면 된다. AAC 프라이밍
  (약 46ms) 편집 리스트는 mp4-muxer 때와 같이 보존하지 않는다(오디오 variant가 원본보다 그만큼 길어짐,
  기존 동작 동일). 다음 후보: mp4box 읽기도 mediabunny `Input`으로 통일(mp4-demux·container-info·remux 3곳).
- 2026-09-03 Claude: B22. 내보내기 e2e를 쓰다가 dev 서버에서 내보내기가 항상 멈추는 결함을 찾았다(위 표).
  turbopack은 `typeof window`를 브라우저 타깃 상수로 접으므로 worker/메인 분기 가드에 쓰면 안 된다
  (컴파일 청크에 `//TURBOPACK unreachable`로 남는다). 2026-09-03 Codex가 프로덕션 webpack 빌드를
  `next start`로 띄워 B22 내보내기 3개 e2e 통과를 확인했다. Codex 확인 요청: 미디어 카드 선택 후 `e` 한 번에 클립이
  두 개 붙는다(e2e 시딩에서 관찰, editor/media-bin 소유). e2e는 상대 개수로 작성해 영향 없음.
- 2026-09-03 Claude: B15 후속 `claude/b15-followups`. (1) 자동 편집 `sampleAudioRms`가 원본 전체를
  decodeAudioData에 넣던 것을 A2 오디오 variant(`audioBlobFor`)로 전환 — 60초 1080p 클립에서 31MB → 734KB
  확인. (2) GitHub Actions를 checkout@v7 · setup-node@v7 · pnpm/action-setup@v6으로 올려 Node 20 런타임
  deprecation 후속 항목을 닫음(CI 통과는 push 후 확인 필요). (3) B15 행을 통합 완료로 갱신.
- 2026-09-03 Claude: B15 실측(Chrome 152, Apple Silicon, 60초 1080p H.264 GOP 30 합성 클립, 같은 프로젝트에서 교대 측정):

  | 항목 | main(요소 seek) | B15 |
  |---|---|---|
  | 가져오기 → 자동 편집 분석 완료(샘플 36장, OPFS 복사·probe 포함) | 2.24초 · seek 49회 | 2.28초 · seek 11회 |
  | 장면 감지(2fps, 120장) | 1.40초 · seek 120회 · 경계 15개 | 0.92초 · seek 0회 · 경계 15개 |
  | 프레임 시각 정확도(색상이 시간 함수인 클립, ffmpeg `-ss` 기준) | 일치 | 일치 |

  자동 편집 경로는 가져오기 비용이 지배해 동률, 밀도 높은 장면 감지는 35% 단축. 검토 중 잡은 결함 2건:
  (1) 선형 디코더가 입력 chunk 기준 reorder 한계로 출력을 닫아 아직 나오지 않은 정답 프레임을 버리고
  다음 run 프레임을 이전 요청에 배정(정확히 한 샘플 지연) → 입력 중단과 출력 수신을 분리.
  (2) chunk 타임스탬프에 elst 지연(B-frame 인코더 67ms)이 남아 있었음 → 표시 시각으로 환산.
- 2026-09-03 Claude: B15 Codex 1차 검토 반영. 발견: `mp4-decoder.ts`의 `description()`이 mp4box box의
  `.value`를 기대했지만 존재하지 않아 항상 undefined → HEVC·out-of-band AVC가 WebCodecs configure에
  실패하고 조용히 `<video>` 폴백(3881341, Codex 승인). B15는 A2/B11이 main에 통합된 뒤라
  `claude/b15-frame-sampler`를 main에서 새로 시작해 3881341만 재적용했다. 실측 수치는 아래 표.
- 2026-09-03 Codex: B14 구현 완료. 자동 선택·보류 이유를 번역된 문장이 아닌 구조화된
  reason code로 저장한다. 얼굴·웃음·골든아워·이야기 위치·음악 에너지·흔들림·화질·중복과
  목표 길이 도달까지 카드에서 설명하며, 타임라인 클립 label도 현재 언어의 설명을 받는다.
  영어 UI의 한국어 촬영 요약 누출도 제거했다. 양 언어 단위 테스트와 1440×900 실제 화면 확인 완료.
- 2026-09-03 Codex: B13 1차 구현. 리포트를 결과 요약 → 추천 시작점·이유 → 상세 수치
  순서로 바꾸고, 진행·일부 실패·전체 실패 상태마다 다음 행동을 안내한다. 추천 이유와 모드명을
  양 언어로 분리해 영어 UI에 한국어가 섞이던 문제도 해소했다. fixture 브라우저 여정과 1440×900
  한국어 화면을 확인했다.
- 2026-09-03 통합: 사용자 승인으로 B9·B10·B11·B12, B6, A2-a와 Codex 보강을 `main`
  `d729c13`까지 fast-forward하고 푸시했다. GitHub Actions CI run 33695848117 전체 통과.
- 2026-09-03 Codex: A2-a를 M3 통합 스택에 합치고, 동일 자산의 동시 cache build를 하나로
  합쳤다. 파생 캐시가 용량 부족·일시 오류로 저장되지 않아도 가져오기·미리보기·내보내기가
  실패하지 않고 원본으로 폴백하며 다음 요청에서 다시 만들 수 있게 보강했다.
- 2026-09-03 Codex: B9·B10·B12 위에 Claude B11(`f8d55c2`)을
  `codex/m3-media-integration`으로 통합했다. lint·typecheck·단위 테스트·Playwright 10개·
  프로덕션 OSV audit·데스크톱 media smoke가 모두 통과했다. 자동화 밖에 남은 M3 게이트는
  실제 iPhone HDR/VFR MOV, HDR gain map HEIC, Live Photo pair identifier, 대량 폴더 검증이다.
- 2026-09-03 Claude: B11 완료. 회전 규약은 "디코드된 프레임을 화면에 맞추려 시계 방향으로 돌릴
  각도"(`SourceRotation` 0/90/180/270). iPhone 세로(matrix [0,1,-1,0]) = 90, ffmpeg
  `-display_rotation 90` = 270. 스파이크 문서의 미확정 항목 중 mp4box `.mov` demux와 WebCodecs
  경로 회전은 해소, 실제 iPhone HDR/VFR만 도그푸딩으로 남음.
- 2026-09-03 Claude: A2-a 오디오 variant 완료. D1 검토에서 지적한 "오디오 엔진·exporter의 파일 전체
  읽기"가 AAC 소스에서 해소됨. 원본이 MP4/MOV+AAC가 아니면(WebM, 무음 영상) 종전처럼 원본을
  읽는다. core `CacheVariant`의 `audio-48k`는 실제 내용에 맞춰 `audio-track`으로 바꿨다. main의
  A1-d(Codex 구현)를 채택했고 Claude의 병합본 브랜치는 폐기했다.
- 2026-09-03 통합: 사용자 승인으로 e3b7c7d → B2 → HEIC 스파이크 → D1 원문 → D1 검토를
  main에 순서대로 올리고 푸시했다. 다음은 새 기준선에서 A1-a(Claude)·A1-b/c(Codex).
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
| B11 HEVC·.mov·회전 | M | 구현 완료, Codex 통합 검증 완료 | `claude/b11-hevc-mov` → `codex/m3-media-integration` · mp4box가 QuickTime `.mov`를 demux(node 검증), `readMp4ContainerInfo`가 코덱·오디오·`tkhd` 회전을 읽어 `MediaAsset.rotation`에 기록, WebCodecs 경로는 `rotate` 셰이더 패스로 회전, `<video>` 경로는 브라우저가 처리. `isConfigSupported`로 미지원 코덱(CI Chromium의 HEVC 등)은 1회만 실패하고 `<video>` 폴백. 남은 일: 실제 iPhone HDR/VFR 검증(도그푸딩), Chrome 채널 HEVC e2e |
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

**유지보수 후속 항목**

- GitHub Actions: `actions/checkout@v4`, `actions/setup-node@v4`, `pnpm/action-setup@v4`가
  Node 20 런타임 deprecation 경고를 냈다(run 33684793493). 2026-09-03 B15 후속에서 v7/v7/v6으로
  올림. 담당 Claude(`.github/`).

WebGPU, 렌더 워커, 백그라운드 렌더 큐, 모바일 네이티브 셸, 영어 랜딩·온보딩,
서명·공증. 성능·전문 작업 검증이나 사용자 발생 같은 조건이 채워지면 꺼낸다.

## 상태

| 배치 | 담당 | 상태 | 비고 |
| --- | --- | --- | --- |
| D1~D4 | 사용자 | 전부 결정 | D1 계약: `docs/decisions/2026-09-03-local-media-storage.md` + `.review.md` (양측 승인, 2026-09-03). D2: desktop 매니페스트 canonical |
| B1 CI 복구 | Claude | 완료 | postcss 8.5.23, nanoid 3.3.18/5.1.16 · audit 0건 |
| B2 정책·포맷 | Claude | 완료, main 통합 | `claude/b2-version-policy` · check-versions 스크립트+테스트, CI 단계, 루트 scripts는 `biome check` 게이트, knip stores 1건. 전면 포맷은 아래 규칙 |
| B3 통합 | Claude | 완료 | feat/identity + B1을 main에 fast-forward, 푸시 (2026-09-03) |
| B4 첫 실행 오프라인 | Codex | 구현·번들 스모크 완료 | arm64/x64 DMG에 MediaPipe·Whisper 포함, DNS 차단 새 프로필 기동 확인. RC 수동 기능 검증은 B5에서 반복 |
| B5 RC | Claude 준비 · 사용자 태그 | 대기 | |
| B6 도그푸딩 템플릿 | Codex | 완료, 통합됨 | `docs/dogfood/TEMPLATE.md` + `SET-01.md`. 세 축 완주 절차, 원본 안전, 지표 계산법, P0/P1/P2 판정 기준 고정 |
| B7 도그푸딩 1회차 | 사용자 | 대기 | |
| B8 P0 수정 | 배정 | 대기 | 영역별 |
| B9 실패 안내 | Codex | 구현 완료, main 통합 · 실기기 오류 검증 대기 | 지원 불가·손상·저장 공간·권한·원본 없음 분류, 파일별 해결 안내·재시도, 부분 파일 정리, 혼합 성공/실패 E2E, `docs/08-media-compatibility.md` |
| B10 HEIC | Codex | 구현 완료, main 통합 · 실제 아이폰 검증 대기 | 원본 참조 + ImageIO 썸네일·4096px 캐시, 촬영 시각·GPS·방향·카메라 메타 보존, 실제 HEIC 통합 테스트. HDR gain map·대량 성능은 B7/B12 게이트 |
| B11 HEVC·.mov·회전 | Claude + Codex | 구현·통합 검증 완료, main 통합 | MOV 컨테이너 코덱·회전 판독, WebCodecs 회전, 미지원 코덱 폴백. 자동 테스트 통과, 실제 iPhone HDR/VFR 검증 대기 |
| B12 Live Photo·폴더 | Codex | 1차 구현·B10/B11 통합 완료, main 통합 · 실기기 검증 대기 | 파일·폴더 선택 + 드롭 재귀, DCIM 상대경로 보존, 동일 폴더·동일 stem HEIC/JPEG+MOV 보수적 연결, 접근 실패 격리·안내. 실제 아이폰 pair identifier·대량 성능은 도그푸딩 게이트 |
| B13 리포트 문구 | Codex | 1차 구현·화면 검증 완료 | 결과와 다음 행동 우선 구조, 진행·일부 실패·전체 실패 안내, 추천 이유·모드명 한국어/영어 분리. 도그푸딩 이해도 검증 대기 |
| B14 컷 이유 | Codex | 구현·화면 검증 완료 | 선택·보류 사유 구조화 및 한국어/영어 표시, 자동 결정 누락 방지 테스트. 도그푸딩 이해도 검증 대기 |
| B15 분석 디코더 공유 | Claude + Codex | 구현·검토 완료, main 통합 | 공유 WebCodecs 샘플러, 디코더·요소 fallback, 스트리밍 장면 감지, 분석 취소, 실제 디코더 E2E와 ffmpeg 시각 정확도 검증. 장면 감지 35% 단축. 남은 일: AI 패널 취소 버튼 연결 · 후속(`claude/b15-proxy-sampler`): 프록시 생성·썸네일·필름스트립도 공용 샘플러로. 프록시 60초 1080p → 640p: 13.3초·seek 1,440회 → 3.3초·seek 0회. 가져오기 썸네일은 seek 0회, 회전 .mov 썸네일 세로 정상. 샘플러 sink가 async를 지원해 encoder 역압이 디코더까지 전달됨 |
| B16 시나리오 | Codex | 대기 | |
| B17 자동 편집 E2E | Claude | 완료, main 통합 | `claude/b17-autoedit-e2e` · 기존 기능 보호용 회귀 테스트, e2e 9개 통과 |
| B18~B21 마무리·공유 | Codex | 대기 | |
| B22 회귀 자동화 | Claude + Codex | 구현·검토 완료, main 통합 | `claude/b22-regression` · e2e `export.spec.ts`: VP9 프리셋 내보내기 → 다운로드 MP4 크기·성공 토스트, 렌더 중 취소 → 취소 토스트·다이얼로그 재사용, 스냅샷 저장 → 변경 → 복원. 작성 중 잡은 결함: (1) 오디오 mixer worker가 dev(turbopack)에서 영원히 무응답 → 내보내기가 "렌더링 99%"에서 멈추고 취소도 불가. 원인은 worker 진입 가드 `typeof window === "undefined"`를 turbopack이 상수로 접어 블록을 제거한 것. `WorkerGlobalScope` 검사로 교체, 5초 무응답 시 inline 폴백 + abort 연결. (2) 렌더 루프에 encoder 역압이 없어 1080p 프레임 수백 장이 큐에 쌓임 → `encodeQueueSize ≤ 8` 대기. (3) AAC는 `AudioEncoder` 존재만 보고 지원 여부를 안 물어 코덱 없는 Chromium에서 실패 → `isConfigSupported`. (4) 취소가 "내보내기 실패"로 표시 → `export.cancelled` 토스트. 단위 4개 추가. dev·프로덕션 Chromium e2e 통과 |
| B23 muxer 교체 | Claude + Codex | 구현·검토 완료, main 통합 | `claude/b23-muxer` · 폐기된 `mp4-muxer`(레지스트리 deprecated, 후속 Mediabunny 지정)를 `mediabunny` 1.55.5(MPL-2.0, ESM·tree-shake)로 교체. `media/mux/mp4-writer.ts`가 4개 호출부(exporter, 오디오 variant remux, 프록시, 지도 전환)에 같은 표면(`addVideoChunk`/`addAudioChunk(Raw)`/`finalize`)을 제공, 트랙별 첫 패킷 0 재정렬(구 `firstTimestampBehavior: offset`)·fast start 유지. 동일성: 단위 라운드트립(fixture 패킷 수·타입·시작 0·구간 길이·moov<mdat), Chrome 내보내기 ffprobe 비교(VP9 300f + AAC 472f, 10.069s 동일). 주의: `finalize()`가 async가 됨. 지도 전환(Codex 파일)은 기계적 교체 확인 완료. Codex가 잔여 테스트 mock·주석을 새 래퍼 기준으로 정리하고 전체 14개 E2E 통과 확인 |
| B24 체크리스트 | Claude 자동화 · 사용자 완주 | 대기 | |
| B25 v0.4.0 | 사용자 | 대기 | |
| A1-a MediaSource 계약 | Claude | 완료, main 통합 | core 타입·fingerprint·cacheKey, zod 스키마(safe relativePath), OPFS adapter, resolver, 디코더 ByteSource(clampReadRange), 컴포지터 연결. Codex 검토 반영(77917f5). CI Node 22 |
| A1-b 데스크톱 카탈로그·`media://` | Codex | 완료, main 통합 | worker 소유 node:sqlite 카탈로그, lease 기반 `media://` Range 프로토콜, source resolver 6상태, VolumeRootResolver. Claude 검토 반영(aed1a1b). 렌더러 `disk` adapter는 A1-d(Claude) |
| A1-c helper 계약 | Codex | 완료, main 통합 | JSON-lines sidecar v1: volume-resolve·volume-mount·inspect·preview·fingerprint, 1차 sips/diskutil. `docs/decisions/2026-09-03-media-helper-protocol.md` |
| A1-d 렌더러 disk adapter | Claude + Codex | 완료, main 통합 | `26e3058` + `4760e18`. 읽기별 lease를 `finally`에서 해제, 정확한 `206`·응답 길이 검증, 전송 실패 시 `sourceState` 복구, IPC 런타임 검증, 길이 0 가드, 브리지 있을 때만 기본 `disk` adapter 등록. `<img>/<video>` fallback도 공통 resolver를 사용하며 오류 응답 CORS·상태 헤더를 노출. 읽기 lease 재사용은 프로파일링 뒤 최적화 |
| A2-a 오디오 트랙 variant | Claude + Codex | 구현·통합 검증 완료, main 통합 | AAC 트랙을 mp4box demux → mp4-muxer 재먹싱(재인코딩 없음)한 audio-only MP4를 OPFS 캐시에 저장. 재생·파형·내보내기 믹서가 variant를 읽고 없으면 원본. Codex가 동시 build 병합과 캐시 쓰기 실패 폴백을 보강. 남은 일: AAC 외 코덱(Opus·PCM), 디코드된 PCM 청크 스트리밍(B15) |
