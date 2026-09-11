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

- 2026-09-06 Codex: B'1 `1b13e6b` 확인 리뷰 반영. 챕터 동일 초 중복 제거, 스크럽 직후 키보드 undo/redo, 끼어든 명령 전후 제스처 리베이스, Yjs 종료 1회 flush, no-op/IME/슬라이더 Escape 보호를 보강했다. 1,000자산 CPU 프레임 비용 p50 1.462→0.045ms(IndexedDB mock), 측정 범위와 회귀 검증은 [감사 기록](evaluations/2026-09-06-precision-input-audit.md)에 둔다.

- 2026-09-06 Codex: B'1 `c52851b` 리뷰 반영. 챕터 파일 초 포맷 복구와 순수 함수 테스트, 스크럽 키보드 격리, 무이력 live preview → 시작 스냅샷 대비 undo 1회, 입력 단위 리마운트로 AiPanel/섹션 상태 보존, invalid blur 복귀·IME 보호·이미지 소스 입력 제외·플레이헤드 상한을 적용했다. 슬립 standalone 명령도 undo를 기록한다. `applyRamp` N+1 undo, 타임코드 약식 입력, 키프레임 상대 시각 표기는 [감사 후속](evaluations/2026-09-06-precision-input-audit.md)에 추가했다.

- 2026-09-06 Codex: B'1 `codex/b1-precision-input` (`main 07d5d33` 기준). [입력 감사](evaluations/2026-09-06-precision-input-audit.md)를 먼저 작성하고 공용 커밋형 숫자/타임코드 입력을 시작·길이·소스 트림·속도·변형·키프레임 값과 트랜스포트에 적용했다. 직접 입력, 화살표/Shift/Alt, 스크럽, Enter/blur 커밋, Esc 취소, 오류 안내와 접근성 라벨을 제공하고 기존 슬라이더를 유지한다. 변형은 기존 history 우회 경로와 별도인 커밋 명령으로 undo를 기록하며, 소스 트림은 속도 램프 적분의 역변환으로 길이를 재계산한다. 요청 범위의 fps 파서/소스 시간 및 E2E를 위해 `packages/core/`와 store 파일도 수정했으며 의존성은 추가하지 않았다. P1/P2 효과·오디오·타임라인 트림·마커/범위 직접 입력과 키프레임 시각 이동·33ms 키 탐색 통일은 후속이다.

- 2026-09-05 Claude: A3 컬렉션·태그·평점 1차(`claude/a3-collections`). 데이터 계층: core `MediaAsset.tags/rating/favorite`,
  `Project.collections`(수동 컬렉션 = 자산 id 목록, 스마트 컬렉션 = 저장된 검색어+필터 스펙). 필터 스펙은 core에서 느슨한
  레코드로 두고 렌더러가 `media/smart-filters.ts`에서 필드별로 검증해 모르는 값은 기본값으로 떨어뜨린다(구 빌드 호환).
  검색: 태그 자유 텍스트 + `#태그` 정확 일치, 필터에 태그(AND)·최소 평점·즐겨찾기·사용 여부(타임라인 참조로 계산, 저장
  안 함)·컬렉션 소속 추가(`SearchContext`). store 액션은 선택 단위로 한 번의 undo, 변경 없으면 레코드 동일성 유지.
  영속화: CRDT meta `collections`(비어 있으면 생략), live-doc 변경 감지, 내보내기 스키마(평점 1~5, 컬렉션 kind 판별).
  삭제된 자산의 컬렉션 소속은 그대로 두어 휴지통 복원 시 돌아오고, 읽는 쪽은 없는 id를 무시한다. UI 1차(Codex 다듬기
  대상): 일괄 처리 바(`bulk-bar.tsx`)에 별점·하트·태그 입력·컬렉션 추가/새 컬렉션, 필터 패널(`media-filters-panel.tsx`,
  media-bin에서 분리)에 평점·사용 여부·즐겨찾기·태그 칩·컬렉션 선택(스마트 선택 시 검색어·필터 로드)·이름 바꾸기·
  삭제·"검색을 스마트 컬렉션으로 저장", 카드 하단에 ★n·♥·#태그수 배지. e2e 2건(`media-marks.spec.ts`).
  리뷰 반영: (1) 내보내기 스키마가 모르는 컬렉션 kind·이상한 필터 값에 프로젝트 전체를 거부하고, CRDT read→null→
  빈 프로젝트 저장으로 문서를 비우던 경로를 막음(모르는 항목은 원형 통과, 잘못된 평점은 버림). (2) 컬렉션을 meta
  JSON 한 덩어리(LWW)가 아니라 미디어처럼 항목 맵 + 순서 배열로 저장해 두 탭이 동시에 만든 컬렉션이 모두 살아남음
  (테스트). (3) 변경 없는 액션은 undo 슬롯을 쓰거나 redo를 지우지 않도록 `runWith` 공통 수정. (4) 태그 여러 개
  입력이 undo 한 단계(`addAssetsTags`). (5) 태그 제거(일괄 처리 바 칩 ×)·컬렉션에서 제외(컬렉션 필터 중) UI 추가.
  (6) 스마트 컬렉션도 이름 변경·삭제 가능(선택 상태를 필터와 분리), 이름 변경 대상 고정. (7) 사용 여부 필터가
  꺼져 있으면 타임라인을 구독하지 않음(클립 드래그마다 재검색 방지). (8) `#태그` 접두 일치, 태그 칩 12개 + 더 보기,
  삭제 토스트에 실행 취소, 별점 radiogroup·아이콘 버튼 aria-label. 남은 LOW: 영구 삭제된 자산 id가 컬렉션에 남음.
  Codex 교차 리뷰(2026-09-05, Orca 감독 하에 읽기 전용 리뷰 → 같은 터미널에서 수정 d8b421f): `runWith`의 no-op
  판정은 참조 동일성이므로 기존 mutator(setAssetProxy·setAssetUseRange·relink/remove 대상 없음, core effect
  제거/토글/같은 위치 reorder)가 변경 없을 때 원래 Project를 반환하도록 한정 수정 + undo 깊이·redo 보존 회귀
  테스트; 스마트 컬렉션은 로드한 query+filters 스냅샷과 현재 값이 달라지는 즉시 선택 표시를 해제(수동 컬렉션 전환은
  기존 검색 조건 유지). 운영 방식 전환: 사용자 지시로 Codex가 구현, Claude는 Orca coordinator로 감독·리뷰·계획.
- 2026-09-05 Codex: A5 후속 프리뷰 저장소 분리(`claude/a5-preview-store`). 썸네일·필름스트립을
  `movie-desk.previews.v1` IndexedDB로 옮겨 자산 편집과 Yjs/프로젝트 행 갱신에서 data URL을 제외했다.
  기존 레코드·HEIC helper·지도 전환·스냅샷 복원·JSON 가져오기의 인라인 프리뷰는 history 밖 maintenance
  migration이 저장 후 제거하고, JSON 내보내기는 다시 인라인한다. 가져오기 lease와 라이브·저장 프로젝트·휴지통·
  손상 행 salvage를 GC keep에 포함했다. 리뷰에서 migration 실행 중 변경 유실, 부분 인라인 JSON 내보내기 누락,
  relink 뒤 예전 filmstrip 잔존과 메모리 캐시 미갱신을 수정했다. 리뷰 후 가시 카드만 프리뷰를 읽도록 바꿔
  Chrome 152, 1,000개 재측정: 프로젝트 JSON 6.9→3.3MB, 가져오기 10.6ms/자산, 이름 변경→Saved 56ms,
  힙 165.9/199.9MB(Claude 재측정 3회: Saved 56~62ms, JSON 3.3MB로 일치). 재연결 Undo는
  메타데이터만 되돌리고 파생 프리뷰는 새 원본 것을 유지한다. migration 전 레거시 자산도 재연결 직전 인라인
  사본을 history 밖에서 제거해 Undo가 새 바이트 위에 옛 그림을 되살리지 않는다. 프리뷰까지 되돌리려면 비동기 저장소를 history
  트랜잭션과 묶어야 하므로 이번 배치에서는 데이터 손실 위험을 늘리지 않고, 아래 재생성 경로를 후속으로 남긴다.
- 2026-09-04 Claude: A5 라이브러리 1,000개 측정(`claude/a5-library-scale`). `apps/web/scripts/bench-library.mjs`가 실제
  Chrome으로 1,000개(비디오 200·이미지 800)를 가져와 가져오기·검색·필터·소스 상태 검사·복원·저장·힙을 잰다
  (`docs/evaluations/2026-09-04-library-1000.md`). 병목은 카드 1,000장이 상태 변화마다 전부 다시 렌더되는 것:
  `media/components/media-card.tsx`로 memo 분리 + `content-visibility: auto`, `useSourceHealth`가 누락 집합이
  바뀔 때만 새 객체, 검사 결과 flush 8→32개. 결과: 검색 166→54ms, 필터 804→346ms, 소스 상태 검사 15.5초→0.5초,
  편집 후 저장 256→69ms. 남은 후보: 날짜 그룹 가상화(필터 변경 346ms), 썸네일 data URL을 프로젝트 문서 밖 캐시로
  (저장 JSON 6.9MB/1,000개). 카드 클릭·드래그·재연결·삭제 동작은 그대로(카드 props로 전달).
  리뷰 반영: `content-visibility`의 paint 격리가 카드 밖으로 그리는 선택 링·키보드 포커스 아웃라인을 잘라 내던 것을
  카드 `<li>`에 4px 패딩을 두어 격리 상자 안에 들어오게 고침(실제 Chromium 스크린샷으로 전후 확인), 자리표시 높이를
  썸네일 크기별(78/113/198px)로, 핀·제외 조회를 Set으로, `selectMissing`을 순수 함수로 뽑아 참조 유지 테스트 추가,
  검사 store 동시성 테스트 40개(flush 경계 포함), 벤치 스크립트에 대기 타임아웃·`finally` 종료·인자 검증.
- 2026-09-04 Claude: A2 메타데이터 인덱스·복합 검색 1차(`claude/a2-search`). `media/search.ts`가 라이브러리에서 검색
  인덱스(이름·촬영일·장소(역지오코딩)·코덱·MIME·해상도 등급·카메라·Live)를 만들고, 자유 텍스트(토큰 AND)와 필터(기간·
  길이·해상도·오디오 유무·장소·종류)를 결합한다. 가져오기에서 컨테이너의 `videoCodec`·`audioCodec`을 자산에 저장
  (core `MediaAsset` optional 필드, 스키마는 passthrough). 미디어 패널 검색창 옆 필터 버튼 → 필터 패널, "n개 중 m개"
  표시와 초기화. 태그·평점·컬렉션(A3)은 아직 없다. 리뷰 반영: 인덱스 항목은 자산 레코드별 WeakMap 캐시(레코드가 불변이라
  바뀐 자산만 다시 계산, 날짜 포맷터는 로케일당 하나), 오디오 유무는 참/거짓/알 수 없음 3값(파형이 없다고 무음으로
  단정하지 않음: 오디오 코덱 → 파형 → 컨테이너를 읽었는데 오디오 트랙이 없음 순), 자정에 한 번 도는 시계로 기간 필터
  재평가, 라이브러리에서 사라진 장소 필터 자동 해제, 초기화는 종류까지 포함, 한국어 동의어(영상·사진·오디오·라이브)
  검색, 재연결에서 다른 파일이면 코덱·썸네일·필름스트립·파형도 새 바이트로 갱신.
- 2026-09-05 Codex: A5 파형 저장소 분리(`codex/a5-waveform-store`). 실제 Chrome 1,000개 필드 구성 측정에서
  `waveformPeaks`가 프로젝트 행 3,320,659B 중 3,079,200B(92.7%)로 확인되어 기존
  `movie-desk.previews.v1`에 waveform 행을 추가했다. 가져오기·재연결·삭제·GC·lease·레거시 migration·JSON
  재인라인과 최대 200개 메모리 LRU를 파형까지 확장하고, 타임라인/range editor/level meter를 필요 시 로드로
  전환했다. 레코드에는 검색용 `hasAudio` 사실만 유지한다. 후측정 JSON 244,659B(-92.6%), 이름 변경→Saved
  63ms(전 136ms). 상세: `docs/evaluations/2026-09-05-library-json-composition.md`.
- 2026-09-06 Codex 리뷰 반영: 동일 지문만 기본 선택하고 선택한 행만 확인 후 연결한다.
  폴더 준비는 최대 1,000개·2분, 볼륨 조회 1회와 quick hash를 사용하며 진행률·취소를 제공한다.
  전체 지문은 커밋에서 대조한다. 숨김 화면의 자동 검사는 생략하고 offline 결과가 다른 볼륨 캐시를 지우지 않는다.
  백업은 변경 시에만 생성하고 최근 3개·시간별 2개·일별 2개를 보존하며 종료 대기는 4초로 제한한다.
  schema v2 상태 표는 초기 표시용 읽기 경로를 추가했고 fresh probe의 생략 근거로 쓰지 않는다.

- 2026-09-06 Codex: A4 데스크톱 후속(`codex/a4-desktop-relink`, base `07d5d33`).
  네이티브 파일/폴더 선택은 메인 프로세스에서 helper inspect/fingerprint로 검사하고, 다른 지문은
  명시적 확인 후에만 카탈로그 참조를 바꾼다. 일괄 후보는 정확한 상대 경로만 사용하며 적용 직전 다시 검증한다.
  30초 간격의 disk 부분집합 health 재검사로 볼륨 복귀를 감지하고 source root와 상태를 카탈로그에 기록한다.
  SQLite worker가 15분 간격/정상 종료 시 최대 7개 스냅샷을 유지하며, File 메뉴에서 수동 백업/복원이 가능하다.
  손상 시 복원을 제안하고, 확인 전에는 덮어쓰지 않으며 이전 DB/WAL/SHM은 별도 보존한다.
  검증·스크린샷과 임시 APFS 볼륨 정리 결과는 [실기 기록](evaluations/2026-09-06-desktop-relink.md) 참조.
  기존 사용자 드라이브는 건드리지 않았고, 물리 USB 분리 검증은 조정자 승인에 따라 릴리스 수동 항목으로 남긴다.
- 2026-09-04 Claude: A4 누락 재연결·휴지통 1차(`claude/a4-relink-trash`). 재연결: 누락 배지가 붙은 OPFS 원본 자산 카드의
  "다시 연결"로 파일을 고르면 크기(없으면 이름)로 같은 미디어인지 확인하고 같은 OPFS 키에 다시 써서 클립을 그대로
  살린다. 크기가 다르면 D1 규칙대로 조용히 바꾸지 않고 차이를 보여 준 뒤 "그래도 연결"을 눌러야 한다. 재연결된
  레코드는 새 객체라 디코더 backoff·소스 상태 검사가 즉시 재시도한다. 휴지통: 삭제한 자산 레코드를 IndexedDB
  `cut_editor.trash.v1`에 30일 보관하고 media GC가 그 파일을 참조로 취급, 미디어 패널 하단 "휴지통 (n)"에서 복원·
  영구 삭제·비우기. 타임라인에서 지워진 클립은 되돌리기(⌘Z)로만 복구된다(안내 문구). 데스크톱 참조 파일(`sourceRef`
  disk)의 재연결은 당시 다음 배치로 남겼으며, 2026-09-06 Codex 후속에서 카탈로그 IPC·helper 지문 확인으로 구현했다.
  리뷰 반영: 복원은 레코드를 먼저 되살린 뒤 행을 지운다(반대 순서면 실패 시 파일이 GC에 사라짐), 휴지통 키는
  `projectId:assetId`(같은 자산 id가 두 프로젝트에 있을 수 있음), 되돌리기로 돌아온 자산의 행은 정리, 영구 삭제·비우기는
  즉시 GC, 원본 교체는 임시 키에 쓰고 옮겨 실패해도 기존 파일이 남음(`replaceMediaFile`), 다른 파일로 연결하면 프록시
  제거·길이·크기·회전 재판독, 프리뷰 안내의 부분 검사가 라이브러리 배지를 지우던 결함은 `prune` 옵션 분리로 수정.
- 2026-09-04 Claude: 도그푸딩 병행 잔여(`claude/preview-missing-followups`). 프리뷰가 누락 자산을 검은 프레임으로만
  보여주던 것을 플레이헤드 아래 클립의 누락 파일 이름을 띄우는 오버레이로 보완(`preview/missing-media-notice.tsx`,
  미디어 패널이 숨겨져 있어도 소스 상태를 직접 확인). FrameSourcePool backoff·스냅샷 저장/복원 단위 테스트 추가,
  프로젝트 파일 버전 불일치 메시지를 `ProjectVersionError` + i18n으로. `docs/06` 기준선을 2026-09-04로 갱신.
- 2026-09-04 Claude: Codex 사용량 제한으로 Codex 몫을 모두 인수(`claude/codex-handover`). (1) 데스크톱: 옛
  `~/Library/Application Support/cut_editor` 데이터는 그 자리에서 그대로 채택(`user-data.cjs`: 첫 실행에 한 번 결정해
  `Movie Desk/user-data-location.json`에 고정, 근거는 우리 origin의 IndexedDB 폴더 `app_cut-editor_0.indexeddb.leveldb`
  존재 여부, userData·sessionData 함께 이동, 복사 없음, 실패해도 기본 경로로 계속); `update-check.cjs`가 semver prerelease 규칙을 적용해
  0.4.0-rc.1 설치에 0.4.0을 안내. (2) 미디어 카드 누락 표시: 라이브러리 변경·창 포커스 때 자산 소스를 열어 1바이트
  읽는 probe(`media/source/probe-source.ts`, 내보내기 사전 점검과 공유) 결과로 빨간 "누락" 배지 + 조치 안내 title.
  (3) B21 완료 화면. (4) knip 미사용 export 정리(semantic 태깅 토글은 호출부가 없어 꺼진 상태 유지 — 제품 결정 필요),
  `onnxruntime-web`는 transformers를 통해 해석되는 전이 의존성이라 knip ignore. (5) "`e` 한 번에 클립 두 개"는
  버그가 아니라 카드 클릭 자체가 타임라인에 추가하는 설계(카드 title "클릭해서 추가")였다 — e2e는 상대 개수 유지.
- 2026-09-04 Claude: 살아 있는 `DecoderHandle` LRU 제한(`claude/decoder-handle-lru`). 프레임 provider가 준비된 자산을
  최근 사용 순으로 최대 8개만 유지하고 넘치면 가장 오래된 것을 닫는다(각 핸들 = mediabunny Input + 4MiB 읽기 캐시
  + 디코더). 컴포지터는 자체 `decodePrepared` 집합 대신 `provider.has(assetId)`를 물어 축출된 자산을 다음 렌더에서
  다시 준비한다. 단위 테스트 3개(축출 순서·재준비·중복 방지), e2e 21 + chrome-hevc 1, Chrome 152 재생·스크럽
  smoke(H.264 B-프레임 + HEVC .mov, configure/decode/frame 일치, 오류 0).
- 2026-09-04 Claude: mp4box 읽기를 mediabunny `Input`으로 통일(`claude/mediabunny-demux`). `renderer/mp4-demux.ts`가
  유일한 ISO BMFF 데먹서가 되어 플레이헤드 디코더·선형 디코더·프레임 샘플러·`container-info`·오디오 remux가 모두
  같은 `openMp4` + `PacketReader`(키 패킷 탐색, 디코드 순서 순회, 키 시각 목록)를 쓴다. `mp4box` 의존성과
  `mp4box-log.ts`를 제거. 확인한 동작 차이: (1) 타임스탬프가 편집 리스트가 적용된 표시 시각이라 플레이헤드
  경로도 B-프레임 소스에서 `<video>`와 같은 시각을 캐시한다(종전엔 원시 cts). (2) HEVC 코덱 문자열이
  `hvc1.…` 대신 `hev1.…`로 나온다 — WebCodecs는 둘 다 받고 description(hvcC)은 동일. (3) 컨테이너 정보의
  `brands`는 `container: "mp4" | "mov"`로 바뀜(소비자는 테스트뿐). 새 fixture `avc-bframes.mp4`(libx264 B-프레임 +
  편집 리스트)로 디코드 순서·표시 시각·키 패킷 탐색을 단위 테스트. 실제 Chrome 152: 1080p H.264(B-프레임)와
  회전 HEVC .mov 가져오기·분석·재생·스크럽에서 configure/decode/frame 수 일치, 디코더 오류 0.
  리뷰 반영: `CustomSource`에 `prefetchProfile: "network"` + 4MiB 캐시(7.7MB 파일 전체 순회 읽기 246회 → 18회,
  플레이헤드 창 12개 → 15회; 1MiB는 창 읽기가 210회로 스래싱), 플레이헤드 디코드 창의 읽기 실패를 디코더
  실패로 처리해 `request()`가 reject되거나 디코더가 새지 않게 함, 선형 디코더는 `packets(from)` 제너레이터로
  순회, 키 시각 조회 실패 시 요소 폴백, 다른 reader의 패킷은 예외. 남은 후속: 스크럽한 자산마다 살아 있는
  `DecoderHandle`(= Input + 캐시)을 LRU로 제한(`webcodecs-decoder.ts`), `docs/04`의 "mp4box demux" 문구(Codex).
  knip의 `onnxruntime-web` unlisted 1건은 Codex의 `download-whisper.mjs`(B19).
- 2026-09-03 통합: 사용자 승인으로 B5 RC 준비(0.4.0-rc.1 범프) → B24 릴리스 체크리스트 → 신뢰성 후속 3건을
  `main`에 fast-forward하고 푸시했다. 통합 head에서 `pnpm gate --continue` 9단계 전체 통과(단위 core 106 · web 376 ·
  desktop 46 · scripts 11, OSV 0건, 프로덕션 빌드, e2e 21개) + 로컬 `chrome-hevc` 1개 통과. `v0.4.0-rc.1` 태그는
  사용자가 따로 만든다.
- 2026-09-03 Claude: 후속 3건(`claude/reliability-followups`). (1) 컴포지터와 요소 폴백 풀이 소스를 못 여는 자산을
  1초마다 무한 재시도하던 것을 `renderer/retry-backoff.ts`(1초 → 2배씩 → 디코더 경로 최대 30초, 요소 폴백은 일시 오류가
  잦아 최대 5초, 성공 시 초기화)로 제한. 첫 실패는 종전처럼 1초 뒤 재시도라 "가져오기 중인 파일" 동작은 그대로이고,
  실패 당시의 자산 레코드를 토큰으로 기억해 프록시 생성·재연결로 레코드가 바뀌면 즉시 다시 시도한다. (2) knip 미사용 export 2건(`MediaProbeError`,
  `SAMPLE_BYTES`)은 export 제거. (3) HEVC .mov 로컬 e2e: `pnpm test:e2e:chrome`이 설치된 Google Chrome
  (`channel: "chrome"`) 프로젝트로 `e2e/hevc-chrome.spec.ts`만 실행 — 회전 HEVC fixture가 90×160 표시 크기로
  들어오고 분석이 `hvc1` VideoDecoder로 프레임을 내는지 확인. CI의 chromium 프로젝트는 이 스펙을 무시한다.
  주의: WebCodecs 지원 조회는 페이지 로드 뒤에 해야 한다(`about:blank`에서는 `VideoDecoder` undefined).
- 2026-09-03 Claude: B24. 누락 미디어에 대한 사용자 표시가 어디에도 없었다: 미디어 카드는 인라인
  썸네일을 그리고, 컴포지터·프레임 소스·오디오 믹서·프록시가 `MediaSourceError`를 모두 삼켜 미리보기는
  검은 프레임, 내보내기는 검은 파일로 "성공"했다. 내보내기 쪽은 사전 점검으로 막았다. Codex 확인 요청:
  (1) 미디어 카드에 누락 상태 표시(소스 상태 조회는 `media/source/resolve-media-source.ts`, 표시는
  media-bin UI), (2) knip 미사용 export 11건 중 autoedit·music 9건은 Codex 파일(`metadata.ts`,
  `reasons.ts`, `semantic.ts`, `story.ts`, `types.ts`, `file-store.ts`, `hooks.ts`), `probe.ts`·
  `webcodecs-fakes.ts` 2건은 Claude가 다음 배치에서 정리. 게이트는 `pnpm gate`(옵션은
  `docs/09-release-checklist.md`)로 통일하자.
- 2026-09-03 Codex: B18 카드 템플릿. 번들 Pretendard를 기본 텍스트·자동 챕터 폰트로
  연결하고 여행 타이틀·챕터 카드·성장 기록 카드 3종을 추가했다. 각 카드의 텍스트와
  배경은 그룹으로 함께 이동한다. 실제 렌더 캡처에서 좌측 정렬 텍스트가 화면 밖으로 밀리던
  기존 로워서드·자동 챕터 좌표 문제도 확인해 수정했다.
- 2026-09-03 Claude: B5 RC 준비. 로컬 빌드 결과는 위 표. Codex 확인 요청(apps/desktop 소유):
  (1) `app.setName("Movie Desk")`로 userData가 `~/Library/Application Support/Movie Desk`가 되어,
  cut_editor 시절 데이터(`…/cut_editor` 아래 OPFS·IndexedDB)는 `app://cut-editor` origin을 유지해도
  보이지 않는다. 이 Mac에는 옛 폴더가 없어 재현 불가 — 사용자 Mac에 `…/Application Support/cut_editor`가
  있으면 첫 실행 시 이관(복사 또는 `app.setPath("userData", legacy)`)이 필요. (2) `update-check.cjs`의
  `compareVersions`가 prerelease 접미사를 무시해 0.4.0-rc.1과 0.4.0을 같게 봄 → RC 사용자가 정식 0.4.0을
  안내받지 못한다. x.y.z가 같으면 접미사 있는 쪽을 낮게 두면 된다. (3) 코드 서명 identifier가 "Electron"
  (ad-hoc, identity null) — 예상된 상태, Gatekeeper 우회 안내는 릴리스 노트에.
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
- 2026-09-03 Codex: B16 고정 시나리오 4종을 추가했다. 사진+영상 혼합은 두 미디어를 모두
  유지하고, 무음악은 모드의 fallback 길이를 박자 수로 다시 곱하지 않으며, 짧지만 사용자가
  고정한 소스는 실제 길이 그대로 사용한다. 중복이 많은 성장 기록은 얼굴·미소 가중치로 가장
  나은 대표 장면을 고른 뒤 촬영 순서를 유지한다. 선언만 돼 있던 `faceWeight`·`wideBonus`가
  실제 후보 점수와 중복 대표 선택에 반영된다.
- 2026-09-03 통합: 사용자 승인으로 B13·B14를 B15 기준선 위에 재배치해 `main` `6ce633d`까지
  fast-forward하고 푸시했다. 리포트 안내와 구조화된 컷 이유가 공유 프레임 샘플러와 함께
  동작하며 로컬 전체 게이트를 통과했다.
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

  통합 과정: Claude가 Orca coordinator로 Codex worker를 감독하며 리뷰 에이전트가 시뮬레이션으로 재현한 결함
  (migration↔relink 경합, 필름스트립 축출 루프, 삭제 배치 경합, 혼합 폴백 판정 등)을 7라운드에 걸쳐 반영했고,
  매 라운드 별도 worktree에서 독립 검증(최종 core 107·web 459·e2e 39)했다.
- 미디어 카드의 "썸네일 다시 만들기": `codex/a5-reload-path` 구현. 현재 원본으로 썸네일·필름스트립·파형을
  범위 읽기·오디오 variant로 재생성한다. 일부 실패 시 기존 프리뷰를 유지하고 실패 종류를 경고하며, 중복 작업을 막고 동시에 최대 2개 처리한다.
- 스냅샷 보존 상한: `codex/a5-reload-path` 구현. 프로젝트별 최근 20개를 남기는 오래된 후보 수를 표시하고
  앱 다이얼로그에서 삭제 대상·날짜·다음 GC의 원본 정리 가능성을 확인한 후 해당 ID만 정리한다. 저장 시 자동 삭제하지 않는다.
- GitHub Actions: `actions/checkout@v4`, `actions/setup-node@v4`, `pnpm/action-setup@v4`가
  Node 20 런타임 deprecation 경고를 냈다(run 33684793493). 2026-09-03 B15 후속에서 v7/v7/v6으로
  올림. 담당 Claude(`.github/`).

WebGPU, 렌더 워커, 백그라운드 렌더 큐, 모바일 네이티브 셸, 영어 랜딩·온보딩,
서명·공증. 성능·전문 작업 검증이나 사용자 발생 같은 조건이 채워지면 꺼낸다.

## 상태

| 배치 | 담당 | 상태 | 비고 |
| --- | --- | --- | --- |
| B'5 Phase 0 | Codex 구현 · Claude 감독/리뷰 | 2라운드 수정·rebase·gate PASS, 통합 리뷰 대기 | 저장 경계 자기 치유·실패 안내, 게이트웨이 대상 합성, Phase 1 방어 주석. main4791476 기준 core161·web721·desktop72·scripts11(965), E2E66/66, gate9/9. 호출부 이관·중첩 영속화는 Phase 1+7. [2라운드 보고서](evaluations/2026-09-07-b5-phase0-round2-report.md) |
| B'5 Phase 1+7 | Codex 구현 · Claude 감독/리뷰 | 3라운드 수정·gate 완료, 재검토 대기 | gate9/9, core162·web783·desktop72·scripts11(1,028), 최종 E2E68/68 두 번 PASS. 고아 엔터티 순서 복원·삭제 클립 참조 복구 알림, 손상 시 라이브러리 복구 사본, 실제 provider 통합 검증, 압축 실패 backoff·유휴 재시도. [3라운드 결과](evaluations/2026-09-07-b5-phase1-round3-report.md) · [결정](decisions/2026-09-07-nested-persistence.md) |
| D1~D4 | 사용자 | 전부 결정 | D1 계약: `docs/decisions/2026-09-03-local-media-storage.md` + `.review.md` (양측 승인, 2026-09-03). D2: desktop 매니페스트 canonical |
| B1 CI 복구 | Claude | 완료 | postcss 8.5.23, nanoid 3.3.18/5.1.16 · audit 0건 |
| B2 정책·포맷 | Claude | 완료, main 통합 | `claude/b2-version-policy` · check-versions 스크립트+테스트, CI 단계, 루트 scripts는 `biome check` 게이트, knip stores 1건. 전면 포맷은 아래 규칙 |
| B3 통합 | Claude | 완료 | feat/identity + B1을 main에 fast-forward, 푸시 (2026-09-03) |
| B4 첫 실행 오프라인 | Codex | 구현·번들 스모크 완료 | arm64/x64 DMG에 MediaPipe·Whisper 포함, DNS 차단 새 프로필 기동 확인. RC 수동 기능 검증은 B5에서 반복 |
| B5 RC | Claude 준비 · 사용자 태그 | 준비 완료, 태그 대기 | `claude/b5-rc` · 버전 0.4.0-rc.1 동기화(D2 스크립트), 릴리스와 같은 경로(`build:web` 모델 프리번들 → electron-builder)로 로컬 DMG 빌드 확인: arm64·x64 각 약 167~169MB, Info.plist 0.4.0-rc.1, mediapipe 36MB + whisper 41MB 동봉, ad-hoc 서명. 태그 `v0.4.0-rc.1` push 시 release.yml이 GitHub Release(초안)에 올림. 태그 전 Codex 확인 2건은 인계 메모 |
| B6 도그푸딩 템플릿 | Codex | 완료, 통합됨 | `docs/dogfood/TEMPLATE.md` + `SET-01.md`. 세 축 완주 절차, 원본 안전, 지표 계산법, P0/P1/P2 판정 기준 고정 |
| B7 도그푸딩 1회차 | 사용자 | 대기 | |
| B8 P0 수정 | 배정 | 대기 | 영역별 |
| B9 실패 안내 | Codex | 구현 완료, main 통합 · 실기기 오류 검증 대기 | 지원 불가·손상·저장 공간·권한·원본 없음 분류, 파일별 해결 안내·재시도, 부분 파일 정리, 혼합 성공/실패 E2E, `docs/08-media-compatibility.md` |
| B10 HEIC | Codex | 구현 완료, main 통합 · 실제 아이폰 검증 대기 | 원본 참조 + ImageIO 썸네일·4096px 캐시, 촬영 시각·GPS·방향·카메라 메타 보존, 실제 HEIC 통합 테스트. HDR gain map·대량 성능은 B7/B12 게이트 |
| B11 HEVC·.mov·회전 | Claude + Codex | 구현·통합 검증 완료, main 통합 | MOV 컨테이너 코덱·회전 판독, WebCodecs 회전, 미지원 코덱 폴백. 자동 테스트 통과, 실제 iPhone HDR/VFR 검증 대기 |
| B12 Live Photo·폴더 | Codex | 1차 구현·B10/B11 통합 완료, main 통합 · 실기기 검증 대기 | 파일·폴더 선택 + 드롭 재귀, DCIM 상대경로 보존, 동일 폴더·동일 stem HEIC/JPEG+MOV 보수적 연결, 접근 실패 격리·안내. 실제 아이폰 pair identifier·대량 성능은 도그푸딩 게이트 |
| B13 리포트 문구 | Codex | 구현·화면 검증 완료, main 통합 | 결과와 다음 행동 우선 구조, 진행·일부 실패·전체 실패 안내, 추천 이유·모드명 한국어/영어 분리. 도그푸딩 이해도 검증 대기 |
| B14 컷 이유 | Codex | 구현·화면 검증 완료, main 통합 | 선택·보류 사유 구조화 및 한국어/영어 표시, 자동 결정 누락 방지 테스트. 도그푸딩 이해도 검증 대기 |
| B15 분석 디코더 공유 | Claude + Codex | 구현·검토 완료, main 통합 | 공유 WebCodecs 샘플러, 디코더·요소 fallback, 스트리밍 장면 감지, 실제 디코더 E2E와 ffmpeg 시각 정확도 검증. 장면 감지 35% 단축. 자동 편집 패널에서 분석 중단·이어하기를 제공하며 완료 결과는 보존하고 미완료 항목만 재개함. 후속(`claude/b15-proxy-sampler`): 프록시 생성·썸네일·필름스트립도 공용 샘플러로. 프록시 60초 1080p → 640p: 13.3초·seek 1,440회 → 3.3초·seek 0회. 가져오기 썸네일은 seek 0회, 회전 .mov 썸네일 세로 정상. 샘플러 sink가 async를 지원해 encoder 역압이 디코더까지 전달됨 |
| B16 시나리오 | Codex | 구현·검증 완료 | 사진+영상 혼합·무음악·짧은 소스·중복 많은 성장 기록 고정 테스트 4종 통과. 모드별 얼굴·풍경 가중치가 실제 중복 대표 선택에 반영 |
| B17 자동 편집 E2E | Claude | 완료, main 통합 | `claude/b17-autoedit-e2e` · 기존 기능 보호용 회귀 테스트, e2e 9개 통과 |
| B18 카드 템플릿 | Codex | 구현·화면 검증 완료 | 번들 Pretendard 기본값, 여행 타이틀·챕터 카드·성장 기록 카드 3종, 텍스트·배경 그룹 이동. 기존 로워서드·자동 챕터 좌표 수정 |
| B19 한국어 Whisper | Codex | 구현·브라우저 오프라인 검증 완료 · 실제 음성 도그푸딩 대기 | multilingual base q8 채택, 한국어/영어 명시 선택, ONNX 런타임 포함 완전 로컬 로딩. 합성 음성 CER·속도 비교와 외부 요청 0건 브라우저 스모크 기록 |
| B20~B21 공유·완료 화면 | Codex → Claude | B20 완료(main 3d251ea) · B21 구현 완료(`claude/codex-handover`) | B20: 가족 720p 추천·YouTube·TV 프리셋, 예상 용량, Chrome 검증(`docs/evaluations/2026-09-03-sharing-presets-export.md`). B21: 내보내기 완료 패널(파일 이름·프리셋·저장 위치, 데스크톱 Finder에서 보기, 다시 내보내기·완료), 누락 미디어 거부 시 대화상자 안 복구·백업 안내. 실기기 메신저·TV 재생과 데스크톱 Finder 보기는 도그푸딩 확인 |
| B22 회귀 자동화 | Claude + Codex | 구현·검토 완료, main 통합 | `claude/b22-regression` · e2e `export.spec.ts`: VP9 프리셋 내보내기 → 다운로드 MP4 크기·성공 토스트, 렌더 중 취소 → 취소 토스트·다이얼로그 재사용, 스냅샷 저장 → 변경 → 복원. 작성 중 잡은 결함: (1) 오디오 mixer worker가 dev(turbopack)에서 영원히 무응답 → 내보내기가 "렌더링 99%"에서 멈추고 취소도 불가. 원인은 worker 진입 가드 `typeof window === "undefined"`를 turbopack이 상수로 접어 블록을 제거한 것. `WorkerGlobalScope` 검사로 교체, 5초 무응답 시 inline 폴백 + abort 연결. (2) 렌더 루프에 encoder 역압이 없어 1080p 프레임 수백 장이 큐에 쌓임 → `encodeQueueSize ≤ 8` 대기. (3) AAC는 `AudioEncoder` 존재만 보고 지원 여부를 안 물어 코덱 없는 Chromium에서 실패 → `isConfigSupported`. (4) 취소가 "내보내기 실패"로 표시 → `export.cancelled` 토스트. 단위 4개 추가. dev·프로덕션 Chromium e2e 통과 |
| B23 muxer 교체 | Claude + Codex | 구현·검토 완료, main 통합 | `claude/b23-muxer` · 폐기된 `mp4-muxer`(레지스트리 deprecated, 후속 Mediabunny 지정)를 `mediabunny` 1.55.5(MPL-2.0, ESM·tree-shake)로 교체. `media/mux/mp4-writer.ts`가 4개 호출부(exporter, 오디오 variant remux, 프록시, 지도 전환)에 같은 표면(`addVideoChunk`/`addAudioChunk(Raw)`/`finalize`)을 제공, 트랙별 첫 패킷 0 재정렬(구 `firstTimestampBehavior: offset`)·fast start 유지. 동일성: 단위 라운드트립(fixture 패킷 수·타입·시작 0·구간 길이·moov<mdat), Chrome 내보내기 ffprobe 비교(VP9 300f + AAC 472f, 10.069s 동일). 주의: `finalize()`가 async가 됨. 지도 전환(Codex 파일)은 기계적 교체 확인 완료. Codex가 잔여 테스트 mock·주석을 새 래퍼 기준으로 정리하고 전체 14개 E2E 통과 확인 |
| B24 체크리스트 | Claude 자동화 · 사용자 완주 | 자동화 완료, 수동 완주 대기 | `claude/b24-release-checklist` · `docs/09-release-checklist.md`. `pnpm gate`(`scripts/release-gate.mjs`)가 CI와 같은 7단계를 한 번에 돌려 표로 요약. e2e 추가 3개(`recovery`·`storage-full`·`missing-media`): 저장 없이 새로고침해도 편집 유지, 손상 JSON·손상 저장 프로젝트 거부와 현재 프로젝트 보존, 한 파일 quota 실패 시 파일별 안내·부분 파일 없음·재시도 성공, 누락 미디어 내보내기 거부. 작성 중 잡은 결함: 참조 파일이 사라진 클립을 검은 프레임으로 렌더하고 내보내기가 "성공"하던 것 → `export/preflight.ts`가 범위 안 클립의 소스를 먼저 열어 보고 파일 이름을 들어 거부(`export.missingMedia`). `pnpm gate --continue` 전체 통과(main 3d251ea 위 rebase 후, 리뷰 반영판): install·버전·lint·typecheck·단위(core 106·web 372·desktop 46·scripts 11)·OSV 0건·프로덕션 빌드·playwright chromium·e2e 21개(38초). 리뷰 반영: 사전 점검이 음소거·솔로 트랙 규칙을 렌더러와 같게 따르고 소스를 열어 첫 1바이트를 실제로 읽음(OPFS·disk 모두), e2e 대기 조건 보강. 수동 항목(DMG 첫 실행·강제 종료·드라이브 분리·두 번째 세트 완주)은 사용자 |
| B25 v0.4.0 | 사용자 | 대기 | |
| A1-a MediaSource 계약 | Claude | 완료, main 통합 | core 타입·fingerprint·cacheKey, zod 스키마(safe relativePath), OPFS adapter, resolver, 디코더 ByteSource(clampReadRange), 컴포지터 연결. Codex 검토 반영(77917f5). CI Node 22 |
| A1-b 데스크톱 카탈로그·`media://` | Codex | 완료, main 통합 | worker 소유 node:sqlite 카탈로그, lease 기반 `media://` Range 프로토콜, source resolver 6상태, VolumeRootResolver. Claude 검토 반영(aed1a1b). 렌더러 `disk` adapter는 A1-d(Claude) |
| A1-c helper 계약 | Codex | 완료, main 통합 | JSON-lines sidecar v1: volume-resolve·volume-mount·inspect·preview·fingerprint, 1차 sips/diskutil. `docs/decisions/2026-09-03-media-helper-protocol.md` |
| A1-d 렌더러 disk adapter | Claude + Codex | 완료, main 통합 | `26e3058` + `4760e18`. 읽기별 lease를 `finally`에서 해제, 정확한 `206`·응답 길이 검증, 전송 실패 시 `sourceState` 복구, IPC 런타임 검증, 길이 0 가드, 브리지 있을 때만 기본 `disk` adapter 등록. `<img>/<video>` fallback도 공통 resolver를 사용하며 오류 응답 CORS·상태 헤더를 노출. 읽기 lease 재사용은 프로파일링 뒤 최적화 |
| A3 컬렉션·태그·평점 | Claude(데이터·검색) · Codex(교차 리뷰·수정) | 구현·교차 리뷰 완료, main 통합(e43b35f + d8b421f) | 태그·평점·즐겨찾기·사용 여부·컬렉션(수동/스마트) 데이터 모델·검색·영속화 + 1차 UI. 남은 것: 카드에서 직접 별점/하트 편집, 컬렉션 사이드바, 자동 편집 후보에 평점 가중치 |
| A2 메타데이터 인덱스·검색 | Claude + Codex 검토 | 구현·리뷰 완료, main 통합 | 자유 텍스트 + 기간·길이·해상도·오디오·장소·종류 필터, 코덱 저장. 리뷰에서 오디오 유무를 3값으로 보강하고 자산별 인덱스 캐시·재연결 메타 갱신을 추가했다. `d2cb6ba` + `7cf9b60`, 원격 CI 통과. 태그·평점은 A3 |
| A5 1,000개 성능 측정 | Claude | 1차 완료, main 통합(f25ebf9) | 벤치 스크립트 + 기록 문서. 검색 54ms·필터 346ms·소스 검사 0.5초·복원 0.6초·가져오기 12ms/자산. 다음: 그룹 가상화, 썸네일 캐시 분리 |
| A5 후속 프리뷰 저장소 분리 | Codex 구현 · Claude 감독·리뷰 | 구현·리뷰 7라운드 완료, main 통합(8d9563a) | IndexedDB 프리뷰 저장소 + 레거시 migration + GC/lease + JSON 재인라인. 1,000개 프로젝트 행 6.9→3.3MB, Chromium E2E 37개 통과 |
| A5 새로고침·프리뷰 백로그 | Codex 구현 · Claude 감독·리뷰 | 구현·리뷰 3라운드 완료, main 통합(05739df); dev 복원 p95만 예산 초과(production 충족) | `codex/a5-reload-path`: 원본 범위 읽기·부분 프리뷰 보존·중복 방지, 목록 확인식 스냅샷 정리. 기존 400ms 목표 폐기: 그리드 mark / 복원 합계 <150ms / 백그라운드 비경합으로 대체. 5회 복원 p50/p95 dev 144/167ms·prod 72/78ms, 비경합 각 5/5·E2E 45개. [평가 문서](evaluations/2026-09-06-reload-path.md) |
| A5 후속 파형 저장소 분리 | Codex 구현 · Claude 감독·리뷰 | 구현·리뷰 3라운드 완료, main 통합(7163c51) | 1,000개 프로젝트 행 3.32MB 중 waveformPeaks 92.7% → 분리 후 245KB(-92.6%), 이름 변경→Saved 136→63ms. 레코드에는 `hasAudio` 사실만(모름은 false로 쓰지 않음). 리뷰에서 파형 LRU retain·레벨 미터 요청 범위·hasAudio 오판을 수정. `docs/evaluations/2026-09-05-library-json-composition.md` |
| A5 후속 미디어 패널 가상화 | Codex 구현 · Claude 감독·리뷰 | 구현·리뷰 4라운드 완료, main 통합(f37941c) | 날짜 그룹·단일 목록을 IntersectionObserver 행 세그먼트로 가상화하고 마퀴를 순수 레이아웃 모델로 계산. 첫 세그먼트 활성 카드 강제 마운트 + 마지막 세그먼트 스크롤 조건에서 수정 전 +14px(구성별 최대 +64px) → 수정 후 드리프트 0px, 좁은 폭 173/200/240px 헤더 버튼 16px 유지. 1,000개 필터 345→48ms, 검색 37ms, DOM 카드 16장, 힙 116/51MB, 가져오기 7.4ms/자산. 새로고침 준비 510ms로 <400ms 목표는 미달해 복원 경로 후속 측정 필요 |
| A4 누락 재연결·휴지통 | Claude(OPFS) → Codex(데스크톱) · Claude 감독·리뷰 | 데스크톱 후속 구현·리뷰 2라운드 완료, main 통합(cfd047c) | 행별 선택·진행률·취소, disk 파일 지문 대조·확인 재연결, 상대 경로 폴더 일괄 미리보기, 볼륨 복귀 자동 검사, 카탈로그 스냅샷·확인 복원. [검증 기록](evaluations/2026-09-06-desktop-relink.md), 물리 USB 확인은 릴리스 §3 |
| C1 새 프로젝트 출발점 | Codex + Claude 검토 | 구현·교차 리뷰 완료, main 통합 | 가져오기·정리, 수동 편집, 안내형 초안의 세 출발점을 같은 전문 편집 작업 공간에 연결했다. Claude 교차 리뷰에서 찾은 미선택 새로고침·전역 드롭·키보드 포커스·모바일 검증·E2E 결합 문제를 후속 수정. `267eee2` + `8342164`, Chromium E2E 36개·Chrome HEVC·원격 CI 통과. 다음은 C2 |
| C2 빈·선택·오류 상태 설명 | Codex 구현 · Claude 감독·리뷰 | 구현·리뷰 4라운드 완료, main 통합(ac112a6) | `codex/c2-state-guidance` · 정상 편집 안내 줄 제거, 누락 오버레이·점선 드롭존 복원, 분석 지연 판정·BPM 창 공유·이름 있는 카드 포커스; 판정/렌더/음악 캐시 21개·E2E 2개, `pnpm gate` 9/9 PASS(단위 662·Chromium E2E 45), 재연결 메타데이터 기반 최근 4개 Promise 캐시·접근성 설명·disabled 드롭존 trusted drop 검증·누락 집합별 닫기 후속 반영 및 최소 폭 화면 갱신. [상태 목록·검증 메모](evaluations/2026-09-06-c2-state-guidance.md), 다음은 C3 |
| A2-a 오디오 트랙 variant | Claude + Codex | 구현·통합 검증 완료, main 통합 | AAC 트랙을 mp4box demux → mp4-muxer 재먹싱(재인코딩 없음)한 audio-only MP4를 OPFS 캐시에 저장. 재생·파형·내보내기 믹서가 variant를 읽고 없으면 원본. Codex가 동시 build 병합과 캐시 쓰기 실패 폴백을 보강. 남은 일: AAC 외 코덱(Opus·PCM), 디코드된 PCM 청크 스트리밍(B15) |
| B'1 프레임·수치 정밀 입력 감사 | Codex 구현 · Claude 감독·리뷰 | 구현·리뷰 3라운드 완료, main 통합(dcfd9ca) | `codex/b1-precision-input` · [감사·적용 범위](evaluations/2026-09-06-precision-input-audit.md), [전체 gate](evaluations/2026-09-06-precision-input-gate.md). 챕터 동일 초 중복·키보드 undo·제스처 리베이스·Yjs 종료 flush 확인 리뷰 반영, 공용 NDF 입력·인스펙터/변형/키프레임 값/플레이헤드 적용. `pnpm gate` 9/9 PASS(단위 739·Chromium E2E 52), 한국어 화면 확인. 잔여 P1/P2는 감사 문서에 명시 |
| C3 첫 완성률 측정 | Codex 구현 · Claude 감독·리뷰 |  구현·리뷰 4라운드 완료, main 통합(59a2ef7); B7 도그푸딩에서 리포트 확인 대기 | `codex/c3-completion-funnel` · 로컬 옵트인 Dexie 로그, baseline 제외 퍼널·복구 결과·JSON 다운로드·삭제. [결정](decisions/2026-09-06-first-completion-metric.md). 2라운드 gate 9/9 PASS(단위 779·E2E 55), 1,000자산 로그 15행·최초 start/import 생존. B7에서 측정 켜고 새 프로젝트 완주 후 리포트 확인 |
| B'2 피치 보존 속도 | Codex 구현 · Claude 감독·리뷰(3라운드 마무리는 Claude) | 구현·리뷰 3라운드 + 후속 2라운드 완료, main 통합(29987f7, 후속 2a2df57) | `claude/b2-pitch-speed` · 자체 WSOLA(외부 의존 없음, `packages/core/src/audio/time-stretch.ts`), 옵트인 `preservePitch`(기존 프로젝트 동작 불변), 워커 렌더·창 단위 전송·128MiB LRU, 속도 섹션 토글·상태 힌트, 내보내기 믹서 적용·varispeed 폴백, AAC priming/preroll edit list 보정(기존 결함) + 보정 실패 강등 안내. [감사](evaluations/2026-09-06-pitch-speed-audit.md), [결정](decisions/2026-09-06-pitch-preserving-speed.md). 10분 내보내기 14.75→3.11초. 남은 후순위: 상관 서브샘플링·30초 경계 위상 지표·worker 재사용·측정 분리·detachAudio volume 키프레임(B'3) 후속(2a2df57): 안티앨리어싱 데시메이션 coarse + 전체 레이트 refine으로 6/10kHz 정렬 정확도를 얻으면서 10분 내보내기 3118→2379ms(-23.7%), 효과 패딩 청크 체크포인트, detachAudio 오디오 효과 이동, 불변 DSP 반환·믹서별 continuation, 워커 풀 2개 재사용. |

| B'3 오디오 미터·버스 | Codex 구현 · Claude 감독·리뷰 | 구현·리뷰 3라운드 + 문서 라운드 + 첫 소리 수정 완료, main 통합(7ed748c, 수정 870fa35) | `codex/b3-audio-bus` · [감사](evaluations/2026-09-07-audio-bus-audit.md), [모델 결정](decisions/2026-09-07-audio-bus-model.md). 선택 모델·CRDT/JSON 저장, 공용 라우팅·스테레오 팬, 실측 peak/RMS/3초 LUFS, 버스·마스터 UI·정밀 undo, export 근사 true peak·과부하 안내. PCM 최대 오차 1.49e-8, 8트랙 미터 처리 최대 0.10ms, 전체 E2E 59 PASS. 2라운드 H1–H3·M2–M10·LOW 4건 반영, full gate 9/9 PASS, 단위 858·E2E 60 PASS; M1 true peak 워커 이전 후속 통합 후 CI에서 첫 소리 546~848ms(예산 500ms) 회귀가 드러났다 — 재생 시작이 미터 워클릿 로딩을 기다렸기 때문. `870fa35`가 재생을 먼저 시작하고 워클릿 완료 시 정지 세대 가드와 함께 미터를 붙이도록 바꿔 로컬 210→76ms(워클릿 1초 지연에도 63ms)로 회복했다. [경위](evaluations/audio-bus/first-sound-regression.md). |

| B'4a 컬러 감사·스코프 | Codex 구현 · Claude 감독·리뷰 | 구현·리뷰 완료, main 통합(0e6804a) | [감사](evaluations/2026-09-07-color-audit.md), [색 관리 결정](decisions/2026-09-07-color-management.md). 기존 스코프를 GPU 다운샘플·비동기 PBO 리드백·워커 계산/표시로 교체, RGB/루마 히스토그램·루마/RGB 파형·BT.709 벡터·클리핑 눈금과 390px 접근 추가. `pnpm gate` 9/9 PASS(단위 886·Chromium E2E 62), 1080p 캡처/리드백 p95 0.065ms + 표시 p95 0.030ms, 프레임 간격 p50 16.665ms 유지. 승인된 B'4b 구현은 다음 행 |
| B'4b 선형 SDR 색 파이프라인 | Codex 구현 · Claude 감독·리뷰 | 구현·리뷰 5라운드 완료, main 통합(41d757b) | RGBA16F 선형 Rec.709 장면·효과 공간 경계, SRGB8 폴백 실동작 검사, LUT sRGB/BT.709/linear 선택·undo·내보내기 일치, BT.709 I420 신호와 6개 프리셋 1/1/1 태그 검증. `pnpm gate` 9/9 PASS(단위 939·Chromium E2E 64). 무효과 native 단일 불투명 클립 합성 147,456·실제 VP9 230,400 채널 차이 0, +1EV 선형 이득 1.99987×. Metal 1080p 프레임 간격 p50 16.7→16.7ms; **SwiftShader p50 16.7→50.0ms(3배, 약 20fps) 회귀는 B’6 후속**; DOM SDR 근사·HDR 비지원·8-bit 폴백 정밀도 한계는 화면에 안내. [감사](evaluations/2026-09-07-color-audit.md), [결정](decisions/2026-09-07-color-management.md) |

### C3 구현 메모 (2026-09-06)

기록이 켜진 뒤 생성되고 가져오기에 도달한 프로젝트만 첫 완성률 분모로 센다. baseline과 보관 상한 때문에 시작이 사라진 기록은 별도로 표시한다. 자산·클립 각 1개 이상인 실제 다운로드 성공이 완성이며 최초 사용자나 도움 여부를 추론하지 않는다. 재연결·스냅샷·재시도는 명시적 결과와 C2 안내 표시 여부를 기록하고, 기준 브랜치에 없는 저장 충돌 해결 UI는 0으로 표시한다. 원래 프로젝트 ID도 SHA-256으로 치환한다. 네트워크 전송·SDK는 없고 i18n은 끝에만 추가했다. B'2 오디오/속도 파일은 변경하지 않았다.

검증 수치·벤치 상세는 `evaluations/2026-09-06-c3-completion-funnel.md`에 기록한다.

### C3 2라운드 리뷰 반영 (2026-09-06)

활동은 메모리에서 합산하여 activity 증분으로 기록하고 단계·복구 행은 보관 정리에서 보호한다. 언마운트/숨김 시 flush, 관련 복구 힌트만 측정, 에피소드당 단일 결과와 assets/resolved, 저장 취소·다중 프리셋 결과 집계를 수정했다. 전체 gate와 1,000자산 머리 행 생존 재측정 수치는 [평가 문서](evaluations/2026-09-06-c3-completion-funnel.md)에 기록한다. 전역 삽입 순서 LOW만 보류하며, 메뉴 폭 제한은 390px 측정 진입을 위해 유지한다.

C3 2라운드 검증 완료: gate 9/9 PASS(core 125·web 571·desktop 72·scripts 11, E2E 55), C3 단위 20개. 새 벤치는 activity 1행을 포함한 전체 15행이며 최초 관찰 start/import 각 1행 생존, 복원 p95 133ms로 150ms 예산 이내다.

C3 3라운드 마지막 정리 완료: 상한 count 초과 시에만 메타데이터 인덱스로 정리, 새 복구 전 이전 pending을 abandoned로 종료, 순수 보관 테스트 9개 복원 및 힌트 없음 “—” 표시; gate 9/9 PASS(core 125·web 583·desktop 72·scripts 11 = 단위 791, C3 32·E2E 55), [검증](evaluations/2026-09-06-c3-round3-gate.md).

### 2026-09-06 B′2 — pitch-preserving speed

| Work | State | Evidence |
| --- | --- | --- |
| B′2 own WSOLA, opt-in model/UI, worker export/preview, 128MiB LRU | PASS — pnpm gate (9/9 steps, E2E 56) | `docs/evaluations/2026-09-06-pitch-speed-audit.md`, `docs/decisions/2026-09-06-pitch-preserving-speed.md` |

No new dependency; absent preservePitch and new speed edits retain legacy sound.
Worker 60s stereo 2×: 116.59ms DSP / 179.94ms first start / 0.29ms new main copy slice.
Existing native AudioContext cold startup exceeds 16ms; DSP introduces no such stall.
Separate coordinator-approved **기존 결함 수정** follows: AAC priming/end padding
currently makes a 1s export 1.066667s despite exact 1s video and mixed PCM.

B′2 기능 커밋: `00e4917` (`pnpm gate` 9/9 PASS; core 134, web 558,
desktop 72, scripts 11; E2E 56). 후속 기존 결함 수정은 AAC 지연을 로컬
보정(현재 2112 samples)하고 preroll 4096을 추가한 뒤 edit list만 조정한다.
패킷·샘플 테이블은 모두 보존하며 ffprobe 영상/오디오/컨테이너 1.000000초 확인.

| Follow-up | State | Evidence |
| --- | --- | --- |
| 기존 결함 수정 — AAC priming/padding presentation | PASS, gate 9/9; core 134 / web 559 / desktop 72 / scripts 11; E2E 56 | `docs/evaluations/2026-09-06-pitch-speed-aac-gate.md`; click +1.542ms, tail RMS 0.250185, ffprobe 1.000000s |

AAC 기존 결함 수정 커밋: `566e271` (독립 gate PASS).
B′2 후속 점검: 동일 키 재연결·늦은 decode 결과 무효화, 재생 중 속도/트림/토글
반영(정밀 입력은 commit/cancel 후), 최신 렌더 요청 1개 대기, 오디오 분리 시
피치·속도 램프 유지 및 Goertzel 지배 주파수 검증을 추가했다.

| B′2 final | State | Gate |
| --- | --- | --- |
| Cache/source invalidation, live speed rescheduling, detached-audio mapping | PASS; ready for Claude review | `pnpm gate` 9/9; 778 unit tests (core 134, web 561, desktop 72, scripts 11), E2E 56; `docs/evaluations/2026-09-06-pitch-speed-final-gate.md` |

- 2026-09-06 Claude: B'2 3라운드는 Codex가 gate 9/9까지 마친 뒤 사용량 한도로 커밋하지 못해, 미커밋 변경을 읽기 전용으로 가져와 `b0e7b03`으로 커밋했다(AAC 보정 측정 실패 시 강등·벤치 baseline `27128d1`·미사용 키 제거·창 기준 어드미션·trimIn+램프 창 테스트). 확인 리뷰에서 mp4-writer의 remux 폴백이 모든 오디오 내보내기에서 패킷 전량을 보관하는 문제를 찾아 `29987f7`로 제거했다(예약 누락은 명확한 오류로 실패, 인코드 루프 타임스탬프 단언). Claude 검증 core 135·web 609·desktop 72·E2E 28, production build 통과 후 main 통합.

### B′2 2라운드 리뷰 반영 (2026-09-06)

`codex/b2-pitch-speed`를 C3 통합 `origin/main ac10c1d` 위로 rebase했다.
충돌은 en/ko i18n 끝 append와 이 문서였으며 양쪽 키·메모를 보존했고
리뷰 수정 전 parity 5/5 PASS를 확인했다. 기존 AAC 보상 `566e271`은
`85628fb`, stale 재생·relink 보강 `bf5ce34`는 `27128d1`로 재작성됐다.

H1 청크별 소스 구간 전송, H2 키별 취소·현재 스토어 guard, H3 실패 시
varispeed 내보내기 및 완료 패널/토스트 안내, M1 즉시 재스케줄·20ms 페이드,
M3 실제 렌더 상태 안내, M4 램프 범위 판정을 반영했다. M2 2개 worker 동시
처리·취소 가능한 대기열과 모노 1회 복사도 반영했다. AAC는 이미 패킷 보존·
edit list·오디오 길이/onset/tail 회귀 검증이 있었으며, 오디오 트랙 presentation
길이 검사를 보강했다. 항목별 기존 반영 근거와 잔여 M5–M8·기타 LOW는
[감사 문서](evaluations/2026-09-06-pitch-speed-audit.md)에 명시했다.

10분 스테레오 오디오 내보내기 단계: 14.75s → 3.11s, 전송 4.608GB →
237.7MB(자산의 1.032배); 영상 인코딩·디코드는 제외한 동일 환경 비교다.
[최종 gate](evaluations/2026-09-06-pitch-speed-round2-gate.md) **9/9 PASS**,
단위 **823**(core 135·web 605·desktop 72·scripts 11), Chromium E2E **57**.
AAC 길이 1.00133s·onset 0.25154s, 미리보기 첫 소리 69.89ms·DSP 121.92ms.


### 2026-09-07 B′3 — audio meters and routing

기준 `origin/main 1c3c0e4` 확인 후 현재 checkout만 `codex/b3-audio-bus`로 변경했다. 기본값은 기존 중앙 stereo/mono 음량을 보존하며, mono를 stereo로 복제한 후 Web Audio stereo 등전력 crossfeed 팬을 적용한다. gain −60…+12 dB, 한 단계 버스·mute·마스터, 삭제된 버스는 마스터로 폴백한다. 기존 export limiter와 정규화는 유지하고 limiter 전 과부하와 정규화 뒤 clipping/근사 true peak를 분리 표시한다.

코디네이터가 팬 법칙과 피치 테스트 2개 수정 예외를 승인했다. `createStereoPanner`·`disconnect`와 Node 테스트의 rAF stub만 보완하여 실제 믹서 그래프를 유지했고 기존 relink/job 취소 검증은 그대로다. 대체 graph mock patch는 사용·커밋하지 않았다. 포트 32119와 동시 gate 부재를 확인한 뒤 [full `pnpm gate`](evaluations/2026-09-07-audio-bus-gate.md) **9/9 PASS**, 단위 **847**(core 143·web 621·desktop 72·scripts 11), Chromium E2E **59/59 PASS**를 확인했다. 모델·저장·미리보기·export·UI·검증 자료는 통합 오디오 버스 기능 커밋으로 묶으며, main 통합·push는 수행하지 않는다.

1,000자산 기준 비교: 가져오기 7451→7392ms, grid-ready p95 373→375ms, reload heap 111.2→107.3MB, DOM 16개·JSON 244659 bytes 유지. 원본 비교는 임시 git archive와 별도 서버를 사용했으며 다른 worktree/사용자 드라이브는 변경하지 않았다. 측정 범위·남은 미리보기/export 효과 차이·단일 LWW 프로젝트 audio 설정의 동시 편집 한계는 감사/결정 문서에 기록했다.

### 2026-09-07 B′3 — 2라운드 리뷰 반영

H1: 재생 중 gain/pan은 10ms `setTargetAtTime`으로 평활화하고 목적지가 바뀔 때만 재연결한다(게인만 바꿀 때 connect/disconnect 0회). H2: 자산 Map과 스트립 추정치를 공유해 1,000자산·8트랙·100회 스크럽 비용을 55.9→1.6ms, 프레임 p95 0.70→0.10ms, Map 생성 1700→1회로 줄였고 값 합계 637.5는 동일했다. H3: Worklet 불가 시 재생 중에도 파형 추정값·추정 라벨을 유지한다.

M7/M10 지연 입력 master 연결·정리와 rAF 가드, M4 DOM 구조, M3 audio 스키마 passthrough, M6 상관 mono 채널 peak +6.02/+4.65dB와 stereo power +3.01dB 구분, M9 인코더 입력(정규화·클램프 후) true peak 측정을 반영했다. M2는 실제 겹치는 PCM 범위만 라우팅하며 M5 모바일 아이콘·M8 미터 >−60 단언과 LOW 4건도 반영했다. M1 true peak 워커 이동만 후속으로 남긴다: 현재 combine 워커는 정규화 전 단계이므로 최종 PCM을 측정하는 별도 상태·취소·fallback 프로토콜 검증이 필요하다.

[2라운드 측정](evaluations/2026-09-07-audio-bus-round2-measurements.json): 실제 미리보기/export PCM 최대 오차 1.49e-8, 8트랙 미터 main 메시지 처리·store 발행 최대 0.10ms 유지(React 제외). [항목별 감사](evaluations/2026-09-07-audio-bus-audit.md)와 [결정](decisions/2026-09-07-audio-bus-model.md)에 근거·범위·미처리를 기록했다. [2라운드 full gate](evaluations/2026-09-07-audio-bus-round2-gate.md) **9/9 PASS**, 단위 **854**(core 143·web 628·desktop 72·scripts 11), Chromium E2E **59/59 PASS**. 헤더 레이아웃 회귀를 수정한 뒤 믹서·타임라인 반복 E2E도 **14/14 PASS**했다.

- 2026-09-07 B′3 3라운드: 벤치 SHA 의존 제거, 미참조 i18n/문서 정리, 잘못된 audio 블록만 복구하고 한·영 안내 1회 표시, scratch 재사용·project ID 캐시·Worklet 출력 테스트까지 반영; B′2 종료 후 포트 확인하여 [gate](evaluations/2026-09-07-audio-bus-round3-gate.md) 9/9·단위 858·E2E 60 PASS, 이번 라운드 미처리 없음(M1 워커 이전은 기존 후속).
### B′2 후속 정리 및 worktree 복구 (2026-09-07)

기준 `origin/main 1c3c0e4b74a9d36a9c05cb8e81da74818e000f1b`에서
`codex/b2-followups`를 재생성했다. 기존 통합된 미커밋 작업은
`b2-pre-followups-integrated-backup` stash로 보관했다.

M5 dense 상관·고주파 fixture, M6 청크 정렬 체크포인트, M7 최대 2개 Worker
재사용, M8 production 계측 제외, detachAudio volume 자동화 승계와 원본 무음,
trim 범위 에너지·NaN/Infinity PCM 가드·audio barrel을 반영했다.
6kHz/10kHz 오차 최대 0.1%, 443Hz의 30초 경계 점프 0.0208–0.0289(<0.05).
Node DSP CPU +9.4–19.1%, Chromium 10분 오디오 단계 3.523→5.296초(+50.3%),
Worker 생성 20→1개이며 fallback은 없다. 성능 비용을 감사 문서에 함께 기록했다.

[전체 gate](evaluations/2026-09-07-pitch-speed-followups-gate.md) **9/9 PASS**,
E2E **57/57**; 추가 회귀 후 lint/typecheck/test 재검증 PASS,
최종 단위 **839**(core143·web613·desktop72·scripts11).
32119 점유 종료를 기다린 뒤 실행했고 종료 후 포트 해제를 코디네이터에게 알렸다.
[감사 문서](evaluations/2026-09-06-pitch-speed-audit.md)의 2026-09-07 절과
[측정 원본](evaluations/2026-09-07-pitch-speed-followups-dsp.jsonl) 참조.
`pitchRevisions` 정리는 B′3 소유 `preview/audio-engine.ts`여서 코디네이터에게
이관 요청했으며, 해당 파일 및 다른 B′3 소유 파일은 수정하지 않았다.


### B′2 후속 2라운드 리뷰 반영 (2026-09-07)

`codex/b2-followups bbd6f1f`에서 이어서 수정했다. 상관 버퍼·클로저를 홉 밖으로
옮기고 에너지 prefix sum을 적용해도 +35.4%여서 8샘플 평균 후 coarse 탐색과
전체 레이트 ±8 정밀 탐색까지 적용했다. 최종 10분 오디오 내보내기 단계는
고정 기준 `1c3c0e4`의 **3118.4ms→2379.0ms(−23.7%)**, Worker 20→1개,
fallback 없음으로 +15% 이내 목표를 충족했다.

효과 패딩의 다음 실제 렌더 시작 지점에 체크포인트를 저장하고 믹서 generator가
명시적으로 전달한다. 전역 WeakMap을 제거하고 core DSP는 인자를 변형하지 않는
`{ channels, continuation }` 반환값으로 변경했다. audio-gain −3dB의 30초
경계 점프 **0.0147–0.0205(<0.05)**, 같은 믹서 재실행 출력 동일,
6/10kHz 지배 주파수 오차 최대 **0.1%**를 검증했다.
오디오 분리는 gain/fade/EQ 등 `audio-` 효과를 이동하고 영상 효과만 원본에 남긴다.
상수 Worker ID 제거, 오류 폐기 일관화, dispose 함수, 짧은 범위·공유 불변
체크포인트 테스트도 포함했다. 3kHz 미만도 비트 동일하지 않아 기존 피치 산출물은
재렌더가 필요함을 감사 문서에 명시했다.

[전체 gate](evaluations/2026-09-07-pitch-speed-followups-round2-gate.md) **9/9 PASS**,
단위 **844**(core144·web617·desktop72·scripts11), Chromium E2E **57/57**.
[감사 문서](evaluations/2026-09-06-pitch-speed-audit.md)의 round 2 절과
[측정 원본](evaluations/2026-09-07-pitch-speed-followups-round2-measurements.json) 참조.
공유 파일은 허용된 `export/audio-mixer.ts` 청크 상태 전달 부분만 수정했다.


### B′2 후속 3라운드 — B′3 통합 기준 rebase (2026-09-07)

`origin/main 5bb97f5737fa9daf72e95810f0be691a43381df4` 위로 rebase했다.
`bbd6f1f`→`3d4b60f`, `87999ed`→`28e898a`로 재작성됐으며 충돌 파일은
`docs/07-work-order.md`, `packages/core/src/index.ts`, `apps/web/src/export/audio-mixer.ts`
세 개다. B′3 메모 전체, audio-routing과 audio barrel export, 라우팅·scratch와
명시적 피치 체크포인트를 모두 보존했다. i18n 변경·충돌은 없었다.

`pitch-mixer.test.ts` 디버그 console.info를 제거했다. DSP 후보 버퍼의 양쪽
8샘플 guard와 실제 ±(search+8) 탐색 범위를 주석으로 정정했고, 공유 Worker 풀의
dispose를 component unmount에 연결하지 않는 이유를 감사 문서에 기록했다.
관련 pitch-mixer/audio-routing 테스트 **10/10 PASS**.
[rebase 후 전체 gate](evaluations/2026-09-07-pitch-speed-followups-round3-gate.md)
**9/9 PASS**, 단위 **875**(core153·web639·desktop72·scripts11), Chromium E2E
**60/60 PASS**. gate 전후 `lsof -ti :32119`로 비점유를 확인했다.

### 오디오 후속 정리 — B′2/B′3 리뷰 (2026-09-07)

`origin/main 1ba350b` 기준 `codex/audio-cleanup`에서 트루피크 측정과
마스터 게인·±1 클램프를 믹서 Worker로 이동했다. 인코더가 받는 Float32 PCM
기준을 유지하며, generator 소유 FIR 체크포인트로 청크 경계·재시도·동시
내보내기를 분리한다. 정규화 분석 패스에서는 피크 측정을 실행하지 않는다.
`useAudioPlayback` cleanup에 `disposePitchWorkers`를 연결해 에디터 언마운트와
React refresh에서 유휴 Worker를 정리하고 진행 중인 Worker는 반환 후 폐기한다.

실제 DSP를 통과하는 잘린 소스 창 + 100ms 패딩 체크포인트 테스트 2개와
unity/감쇠/증폭·클램프·청크 경계 피크 테스트 3개를 추가했다.
Chromium 3회 중앙값 기준 메인 트루피크 연산은 60초 **204.9ms**, 10분
**2474.8ms**에서 제거됐고, 반환값 bookkeeping은 타이머 해상도 미만이었다.
Worker 경과 시간은 각각 **242.1ms / 2546.4ms**로, 총 내보내기 시간 단축을
주장하는 수치는 아니다. 선택 항목인 `renderClipAudio` 함수 분리는 후속으로 남겼다.

[감사·측정 설명](evaluations/2026-09-07-audio-cleanup-audit.md),
[측정 원본](evaluations/2026-09-07-audio-cleanup-measurements.json),
[전체 gate](evaluations/2026-09-07-audio-cleanup-gate.md) 참조.

최종 `pnpm gate` **9/9 PASS**, 단위 **883**(core153·web647·desktop72·scripts11),
Chromium E2E **61/61 PASS**. 포트 충돌 후 코디네이터의 우선 배정을 받아
전체 gate를 재실행했고 전후 `lsof -ti :32119` 비점유를 확인했다.

후속: 크롭 구간별 기준 채널 선택 차이로 미리보기와 내보내기가 서로 다른 채널을
기준으로 삼아 스플라이스 지점이 달라질 수 있으므로 기준 채널 선택 정책을 별도 검토한다.

### 오디오 정리 2라운드 (2026-09-07)

피크·클리핑을 모두 누적 진단값으로 통일하고 게인 적용을 반환 전 명시적 호출로
분리했다. `TruePeakCheckpoint` 타입과 복원 가드, 벤치마크 오류·타임아웃 처리도
추가했다. 기존 완료 패널 클리핑 4100·리미팅 6 회귀 검증과 벤치마크 6회 측정
동일성을 확인했다. [항목별 결과](evaluations/2026-09-07-audio-cleanup-round2-review.md),
[전체 gate](evaluations/2026-09-07-audio-cleanup-round2-gate.md) **9/9 PASS**,
단위 **885**(core155·web647·desktop72·scripts11), Chromium E2E **61/61 PASS**.
gate 전후 `lsof`에서 32119 리스너가 없음을 확인했다.

### B'4a 구현 메모 (2026-09-07)

코디네이터 승인으로 컬러 작업을 분할했다. B'4a는 기존 스코프의 제품 완성과 감사·결정 문서이며 B'4b는 색 연산 자체의 전환이다. 초기 조사와 달리 기존 스코프가 있었고 P3 프레임 업로드에서 브라우저 gamut 변환을 실측했다. VP9 출력은 colr가 존재하지만 6/6/6(SMPTE170M)이므로 BT.709 태그를 보장하지 않는다. +1EV는 18% 그레이에서 선형 2배가 아닌 4.63배였고, 이는 이번 라운드에 변경하지 않았다. 피처 매트릭스의 피치 보존 행과 SDR 스코프 구현 범위도 정정했다. gate·측정 결과는 감사 문서에 기록한다.

### B'4b 구현 메모 (2026-09-07)

`origin/main` `0e6804a` 위에서 같은 브랜치를 이어 썼다. 모든 시각 효과에 동작
공간을 선언하고, 입력 역트랜스퍼·선형 연산·출력 트랜스퍼를 분리했다. LUT의
기본 sRGB 가정과 사용자 선택을 프로젝트에 저장하고 undo·미리보기·실제 내보내기
경로에서 검증했다. 기존 프로젝트는 선형 연산에 따른 외관 변경을 프로젝트별
1회 안내한다. Native 무효과 단일 불투명 클립은 별도 legacy bypass를 유지한다.

감독 승인에 따라 VideoFrame 업로드의 런타임 전송함수 프로브를 사용하고, DOM
video의 불확실한 전송함수는 파일명을 포함한 C2 StateHint와 내보내기 완료 안내로
노출한다. 별도의 raw YUV DOM 폴백은 B'6 후속 후보이며 이 라운드에서 색 정확도를
주장하지 않는다. HDR 톤 매핑·광색역 출력도 남아 있다. RGBA16F 음영 왕복은 256
코드를 유지하지만 SRGB8 폴백은 100 코드·최대 4(SwiftShader)/6(Metal) 코드 오차여서 정밀도 안내를 둔다.

내보내기는 표시 sRGB를 실제 limited BT.709 I420로 변환한다. 6개 프리셋 모두
encoder metadata·디코더가 읽은 bitstream·MP4 colr가 1/1/1 limited로 일치했다.
성능 검증 중 GPU packing은 느려서 폐기했고, 2-slot transferable Worker로 CPU
변환과 다음 프레임 렌더를 겹쳤다. 10분 전체 내보내기의 전후 시간과 잔여 성능
후속은 감사 문서 및 아래 최종 검증 메모에 기록한다.

B'4b 최종 성능 검증: 무효과 불투명 검정 1080p30·10분·18,000프레임 전체
내보내기는 **287.6616→238.8092초, −48.8524초(−16.98%)**로, 디코딩 plane
SHA-256와 파일 크기 1,067,918B가 동일하다. 이를 내용 차이를 통제한 대표값으로
기록하며, 색 변환 함수 단독 시간이 아닌 2-slot 워커 겹침을 포함한 end-to-end
결과다. +1EV 계조 fixture는 **608.7926→675.2099초, +66.4173초(+10.91%)**이며
계조 보존에 따라 출력 65.50→212.28MB와 인코딩 부하가 달라지는 별도 결과다.
동기 managed 776.9624초에서 워커로 101.7525초를 줄였다.

**B'6 후속 등록:** SwiftShader 1080p 프레임 간격 p50 16.7→50.0ms의 소프트웨어
렌더러 회귀와 graded 내보내기 잔여 +66.42초를 대상으로 전송함수/float 패스를
최적화하고, 실영상으로 하드웨어 10분 내보내기를 다시 측정한다. 현재 Apple M4
ANGLE Metal 재생은 p50 16.7→16.7ms·p95 18.4→18.2ms이며, 중립 내보내기에는
양의 잔여 회귀가 없다. 이 로컬 수치를 모든 GPU·브라우저의 성능으로 일반화하지
않는다. raw DOM YUV 폴백·HDR/광색역 출력은 별도 범위로 남긴다.

최종 `pnpm gate` **9/9 PASS**: core155·web672·desktop72·scripts11, 합계 **910**
단위 테스트와 Chromium E2E **64개** 통과, OSV 167 패키지 취약점 0건. 초기
gate에서 잡힌 새 안내 토스트의 타임라인 클릭 차단은 미리보기 내부 C2 StateHint로
옮겨 해결했고, 기존 marquee E2E를 수정하지 않은 채 통과했다. [gate 보고서](evaluations/2026-09-07-color-linear-gate.md).


B’4b 2라운드(8cf9505 리뷰): 17종 블렌드 모두 선형 Rec.709 계약을 선언하고
인코딩 W3C 외관과의 비호환을 명시했다. 17종 실제 GPU 전후 RGB는
[감사 표](evaluations/2026-09-07-color-audit.md)와
[측정 JSON](evaluations/2026-09-07-color-blend-round2.json)에 기록했으며,
마이그레이션 문구에 multiply·screen·overlay·soft-light를 포함했다. 내보내기는
첫 실제 프레임을 preparing에서 인코딩·flush해 다른 색 메타데이터를 즉시
거부하고, 메타데이터 없음은 번역된 근사 안내로 계속한다. 해상도별 소스 타깃
LRU와 별도 정지 이미지 캐시, 엄격한 셰이더 치환 계약, RGBA 샤프닝을 반영했다.
SwiftShader **16.7→50.0ms(3배)** 회귀를 숨기지 않으며, B’6에서 낮은 미리보기
해상도·전송 패스 캐시·성능 안내를 검증한다. 정밀도 저하를 자동 완화책으로
적용하지 않았고, 현재 소프트웨어 렌더러 성능 개선을 주장하지 않는다.

2라운드 최종 `pnpm gate` **9/9 PASS**: core155·web701·desktop72·scripts11,
총 **939** 단위 테스트, Chromium **64/64**(181.0초), OSV **167** 패키지 취약점
0건, build·tsc·biome 통과. [gate 표](evaluations/2026-09-07-color-linear-round2-gate.md).
첫 단위 실패는 테스트 VideoEncoder의 중복 flush 재생을 바로잡았고, 이후 기존
오디오 미터 E2E의 5초 시간 초과 한 건은 코드·테스트 수정 없이 전체 gate
재실행에서 통과했다. 자세한 실패 이력과 선택 항목의 잔여 범위는 감사에 남겼다.


**B’3 당시 열린 항목 — 오디오 미터 워클릿 부착 경합 (2026-09-07 릴리스 정리에서 테스트 보강 완료, 아래 메모):** `870fa35`는 재생을 먼저
시작하고 워클릿을 나중에 부착하므로 첫 미터 값까지의 시간이 보장되지 않는다.
로딩이 느리면 기존 E2E의 5초 단언 시점까지 -60dB가 유지될 수 있다. 무수정
재실행 통과로 이 항목을 닫지 않는다. 후보 수정은 테스트가 워클릿 부착 완료를
명시적으로 기다린 뒤 미터 값을 단언하도록 하는 것이다. 이번 B’4b 배치에서는
오디오 코드와 테스트를 수정하지 않았다.


B’4b 3라운드(`f4adad6` 리뷰): null/빈/부분 일치 색 메타데이터는 근사 경고,
실제 모순 값만 preflight 하드 실패로 처리하고 정상 BT.709 긍정 테스트를 추가했다.
소스 64MiB·이미지 128MiB, Compositor당 합계 192MiB 예산과 초과 소스 리샘플링,
변환 후 원본 업로드 저장소 해제로 캐시를 제한했다. 1,000개 4K 이미지 벤치의
추적 텍스처 유지량 **1642.29→182.48MB**, 피크 **1708.65→215.65MB**,
GC 후 JS 힙 **2.511→2.539MB**이며 드라이버 전체 VRAM 측정은 아니다.
큰 소스의 공간 해상도 절충·예산 외 저장소와 재현 범위는
[감사](evaluations/2026-09-07-color-audit.md)에 명시했다.
최종 `pnpm gate` **9/9 PASS**: core155·web709·desktop72·scripts11, 총 **947**,
Chromium **64/64**(185.9초), OSV 167 패키지 취약점 0건, tsc·biome·build 통과.
[gate 표](evaluations/2026-09-07-color-linear-round3-gate.md).

**B’4b/B’6 당시 열린 항목 — 전체 스위트 마지막 분석 샘플러 간헐 실패 (2026-09-07 테스트 격리·진단 보강 완료, 근본 원인 미확정):**
`e2e/webcodecs-sampler.spec.ts:25`의 실제 VideoDecoder 분석 테스트가 리뷰 중
전체 실행 3회 중 1회 실패(나머지 63개 통과, 3.1분)했고 단독 실행은 통과했다.
Claude의 후속 전체 실행 2회도 64/64였지만 재실행 통과로 닫지 않는다.
원래 상세 단언·error-context는 검증 worktree 삭제로 남아 있지 않아 디코더 실패,
분석 완료 대기 실패, GPU 압력 중 하나로 단정할 수 없다. 분석 자체는 320×180
VP9를 VideoDecoder → 160×90 Canvas2D로 읽어 Compositor 캐시를 직접 쓰지 않지만,
앞선 63개 테스트가 공유 브라우저 GPU 프로세스에 남기는 간접 압력은 미확정이다.
이번 라운드에서 예산 상향 전후 전체 스위트를 각 3회, worker 1·retry 0으로
재현 시도하며 전체 로그와 실패 산출물을 보존한다. 다음 재현에서는 실패 단언,
분석 단계, decoder configure/frame/error 및 context-lost·GPU 프로세스 자원 정보를
동시에 수집해 B’4b 관련성부터 판정한다. [조사 및 반복 결과](evaluations/2026-09-07-color-linear-round4-review.md).

B’4b 4라운드(`d94481c` 리뷰): 소스·이미지 캐시 각 **192MiB**, 단일 타깃
**128MiB**, Compositor당 합계 **384MiB**로 한 프레임 작업 집합을 수용한다.
실제 VideoFrame+텍스트 벤치에서 4K 영상+1080p 제목의 180프레임 타깃/FBO
재할당 **360→0**, 평균 **13.21→7.16ms**; 영상 2개·4K 스틸 3장·초과 영상+
제목도 워밍업 후 축출 0이다. 두 export 모의의 conflict helper, 벤치 기준 SHA
인수화, aliasing 절충 설명, preflight 경고 래치 주석을 반영했다.
`pnpm gate` **9/9 PASS**, core155·web709·desktop72·scripts11(**947**), tsc0·
Biome clean·build PASS·OSV167 취약점0; 전체 E2E는 예산 상향 **전 3회 + 후
3회 모두 64/64**(retry0, 32119 매회 lsof 확인)이다. 샘플러 간헐 실패는
재현되지 않았으나 위 열린 항목을 유지하며, 원래 실패 요약과 새 6회 로그,
메모리 증가 비용 및 산술은 [4라운드 감사](evaluations/2026-09-07-color-linear-round4-review.md)에 남겼다.


### 2026-09-07 릴리스 전 정리 — Codex 구현, Claude 감독·리뷰

`origin/main cd8b653` 기준 `codex/release-cleanup`(구현 `2d449ac`). docs/09의 과거 네 빈틈을
코드와 git 이력으로 재확인했다: 누락 배지 `173a4db`(9/4), 백오프 `f1cb0f7`·
토큰 변경 `19d79c3`(9/3), 스냅샷 단위 테스트 `749a92e`(9/4)는 이미 해결됐다.
버전 오류 UI·en/ko 키도 `749a92e`에 있었으므로 재사용하고, 이번에 예외의 영어
진단 문자열을 기계 판독 코드로 정리했다. 파서 두 방향 및 en/ko 두 방향 UI 거부·
열린 프로젝트 보존 검증을 고정했다. docs/09에 릴리스마다 실제 코드 재확인 규칙을 추가했다.

샘플러는 decoder support/flush/close 및 입력 dispose를 코드로 확인했으나 원래
간헐 실패의 원인을 단정하지 않는다. 해당 스펙 전용 브라우저 프로세스의 launch/close,
실제 frame poll, 성공·실패 decoder 통계 attachment로 테스트를 보강했다(재시도 상향 없음).
이로써 이 배치의 테스트 견고화는 완료이며, 재발 시 attachment로 원인을 추적한다.

B′3 미터 테스트는 기존 `Measured master`(live=true)를 먼저 기다리고 값 > -60dB를
검증한다. 1.5초 worklet 로딩 지연과 30초 톤으로 부착 전에 소리가 끝나는 경합도
검증한다. 제품 재생 경로·첫 소리 지연은 변경하지 않았다.

선택 항목 중 web scripts lint 누락과 발견된 reduce 누적 객체 복사를 수정했다.
i18n 일괄 삭제·renderClipAudio 분리·audio-engine의 pitchRevisions 수명 정리는
보류했다. **B′2 크롭 구간별 WSOLA 기준 채널 차이는 열린 항목 유지**(청취 A/B 필요).
[변경 근거·잔여 범위](evaluations/2026-09-07-release-cleanup.md),
[전체 gate](evaluations/2026-09-07-release-cleanup-gate.md).

최종 `pnpm gate` **9/9 PASS**: core155·web711·desktop72·scripts11, 총 **949**,
Chromium **66/66**(186.3초, retry0), OSV167 취약점0, tsc·lint·build PASS.
첫 gate 후 보강한 샘플러 단언의 기준 시점 오류(분석은 패널 클릭 전 import 때 시작)를
단독 검증에서 잡아 가져오기 전으로 수정했고 최종 전체 gate에서 재확인했다.
최초 실패 이력은 위 보고서에 보존했다. Claude 리뷰·RC DMG 수동 체크리스트는 대기한다.

2026-09-07 B'5 Phase 0 (`codex/b5-phase0`, 기준 `c072cd0`):
[오디오 선행 결정](decisions/2026-09-07-nested-sequence-audio-routing.md)은 내부 믹스를
스테레오로 접고 sequence volume envelope와 부모 트랙/버스를 적용하며 프로젝트 master는
루트에서 한 번만 적용한다. Solo는 timeline별이며 부모·자식 게이트를 모두 통과해야 한다.
`Timeline.id`, `Project.timelines/rootTimelineId`, `findTimeline`과 두 공통 관문
`recompute`/`replaceTrack`의 대상 선택 시그니처를 준비했다. 기존 `recompute` 18곳과
`replaceTrack` 2곳은 여전히 루트 기본값을 사용하며 호출부 이관은 Phase 1의 몫이다. 관문 밖 마커·뷰·믹서·멀티캠·스토어 쓰기도
루트 alias와 collection을 함께 갱신한다. JSON·CRDT 기존 필드 보존과 로드 직후 되쓰기,
편집/undo/redo alias 동일성을 회귀 테스트로 고정했다.

`project-io.ts` 어댑터가 기존 v1 codec을 감싸므로 동시 배치의 `project-export.ts`는
수정하지 않았다. zod·CRDT 저장 스키마도 그대로이며 새 필드는 런타임에서만 파생한다.
중첩 필드의 `.catch()` 복구는 금지하고 다중 timeline의 v1 저장은 변경 전에 실패시킨다.
지정 grep 방식은 **239→247**(web157·core90), 단어 경계를 적용하면 **241**이다:
원래 식이 새 `project.timelines` 6회도 단수 접근처럼 센다. 호출부 일괄 전환은 하지 않았다.
`pnpm gate` **9/9 PASS**, core160·web718·desktop72·scripts11(**961**), E2E **64/64**,
OSV167 취약점0이며 32119 사용 전 lsof와 다른 gate 프로세스가 없음을 확인했다.
[gate 기록](evaluations/2026-09-07-b5-phase0-gate.md). Phase 1 이후 구현과 통합 리뷰가 남는다.


B'5 Phase 0 2라운드: `toLegacyProject`가 같은 ID의 루트 객체 불일치를 자체 정규화하고,
자동저장 디바운스·cleanup 실패 모두 토스트와 저장 실패 상태에 반영한다. 이후 편집의
성공한 저장으로 복구되며 Yjs 저장 완료가 오류 표시를 숨기지 않는다. `replaceTrack` 결과는
대상 ID를 운반해 `recompute` 합성 시 자식 duration을 갱신한다. Phase 1의 중첩 검증 오류는
CRDT catch에서 null로 삼키면 안 된다는 경고를 남겼다. 기존 호출부 18+2곳은 루트 기본값을
유지하며 이관은 Phase 1이다. main `4791476`으로 rebase했고 최종 gate **9/9 PASS**,
core161·web721·desktop72·scripts11(**965**), E2E **66/66**(186.5초, retry0), OSV167 취약점0이다.
[항목별 결과 및 잔여 사항](evaluations/2026-09-07-b5-phase0-round2-report.md),
[최종 gate](evaluations/2026-09-07-b5-phase0-round2-gate.md). 통합 리뷰가 남는다.

### 2026-09-07 main CI 색 복구 검증 구조 수정 — Codex 구현, Claude 감독·리뷰

`origin/main 8f028cf` 기준 `codex/ci-color-verify`: 색 복구 E2E에서 별도 Node/GPU
감사 스크립트 호출과 두 번째 브라우저를 제거했다. 기존 감사는 무조건 float 읽기와
하이라이트 보존을 요구하므로 SRGB8도 정상인 CI 복구 검증과 계약이 달랐다.
원래 CI의 `Command failed`만으로 특정 GPU 프로브 실패를 확정할 수는 없으며,
원인 후보와 검증 구조의 확정된 문제를 [보고서](evaluations/2026-09-07-ci-color-verify.md)에 구분했다.

기존 페이지의 실제 색 효과 픽셀·새 타깃 할당·컨텍스트 복구·경고를 전후 확인한다.
자연 정밀도 경로는 half-float/SRGB8 모두 허용하고, 강제 SRGB8 경로는 실제
감소 정밀도 안내와 복구 후 재보고를 단언한다. 소스 SDR 근사 안내 계약도 유지하며,
실패 시 브라우저 오류·타깃 상태를 CI 로그와 JSON attachment에 남긴다.
제품 코드·skip·retry 설정은 변경하지 않았다. 감사 스크립트는 float GPU용 수동 도구로 유지한다.

최종 gate **9/9 PASS**, core161·web725·desktop72·scripts11(**969**),
OSV167 취약점0, lint·tsc·build PASS. 전체 E2E **68/68 × 3회 연속 PASS**(retry0),
32119 매회 lsof 확인. 브라우저 단계 **235.6초 → 160.6·162.3·161.3초**,
기존 복구 테스트 **35.1초 → 두 경로 합계 2.7~2.8초**이다. 최초 SRGB8 픽셀의
1코드 양자화 단언 실패도 보고서와 로그에 보존했다. Claude 리뷰와 후속 Linux CI는 남는다.
[전체 gate](evaluations/2026-09-07-ci-color-verify-gate.md).


2026-09-07 B'5 Phase 1+7: JSON v2와 CRDT v3를 같은 커밋으로 완성했다.
v1 라이브러리·snapshot은 형태 기반 인메모리 변환만 하며 열기나 썸네일 정리로
원본 행을 덮어쓰지 않는다. v2 CRDT는 별도 문서에서 검증 후 원자 적용하며 레거시
루트와 전체 이전 encoded update를 보존한다. 후보 필드 누락, 비활성 자식·충돌 ID 왕복,
마이그레이션 실패 원본 보존, hydration 전/실패 후 flush 차단을 검증했다.
최종 gate **9/9 PASS**, 단위 **1,001개**, 전체 E2E **68/68 두 번 PASS**.
실패했던 이전 실행은 성공 횟수에서 제외했다. Claude 검토 요청은 응답 대기로,
검토 완료·main 통합을 주장하지 않는다.
[보고서](evaluations/2026-09-07-b5-phase1-report.md) ·
[gate](evaluations/2026-09-07-b5-phase1-gate.md).


### 2026-09-07 B′5 Phase 1+7 — 2라운드 리뷰 반영

`1481e25` 리뷰의 필수 4건을 수정했다. v2/v3 삭제↔이동 병합의 미참조 항목은
읽기에서 제외하고 이후 쓰기로 정리하며, 실제로 순서에 남아 있는 누락 항목은
계속 검증한다. 일시적 무효 편집은 UI 예외 대신 저장 실패로 표시하고 정상 편집에서
재시도한다. 마이그레이션 백업은 1MiB 상한, v3 IndexedDB 커밋 확인 뒤 폐기 및
원자적 로그 압축으로 바꿨으며, 용량 초과·abort를 표시한다. 후보 필드 단언은
mock 바깥으로 옮겼다. 자식 오디오 복구 알림·누락 라이브러리 행 복원·간결한 오류
문구도 반영했고 루트 JSON 별칭 중복 유지 이유는 결정 문서에 기록했다.

A5 규모 저장 벤치(1,000자산/1,000클립, 각 300회)에서 `1481e25` 대비
동기 Yjs 쓰기 p50 **4.70→3.90ms**, p95 **5.20→4.60ms**였다.
전체 가져오기/렌더/IndexedDB 커밋 시간 측정은 아니다.
[2라운드 결과·검증](evaluations/2026-09-07-b5-phase1-round2-report.md),
[결정](decisions/2026-09-07-nested-persistence.md).

2라운드 최종 검증: **pnpm gate 9/9 PASS**, 단위 **1,015개**(core162·web770·desktop72·scripts11),
저장 관련 **150개**, 전체 E2E **68/68 두 번 PASS(2.7m·2.6m)**. 각 실행 전 32119 lsof 확인.
기존 RC1 도그푸딩 기록지는 변경하지 않았다.


### 2026-09-07 B′5 Phase 1+7 — 3라운드 리뷰 반영

`4340422`의 순서 권위 정책을 수정했다. 순서 밖에 남은 타임라인·트랙·미디어·컬렉션은
맵의 존재를 보존하고 끝에 복원하며, 실제 `reconcileSequence` 이동과 삭제가 충돌해
실체 없는 클립 순서가 남으면 참조만 제거한다. 두 복구 모두 열림 세션당 1회 알린다.
손상 검증 오류에는 원본을 보존하는 라이브러리 복구 사본 열기를 연결했다.
실제 IndexeddbPersistence로 단일 writer·500회 압축·destroy 리스너 해제·재하이드레이션을
검증하고, 압축 실패 카운터와 강제 압축 플래그를 초기화해 매 편집 전체 병합을 막았다.
실제 live-doc + writer 통합 테스트는 복구 후 저장과 알림, 유휴 중 용량 오류 재시도,
복구 사본의 저장 가능성과 손상 원본 보존을 검증한다. IDB 실패는 2초부터 30초 상한으로
유휴 재시도하며, 오디오 복구의 배열 인덱스 대응 전제도 주석으로 남겼다.
최종 검증: gate **9/9 PASS**, core **162**·web **783**·desktop **72**·scripts **11**
= **1,028 테스트**(persistence **163**), 전체 E2E **68/68 두 번 PASS**(각 2.7분).
두 번 모두 32119 포트의 미사용을 lsof로 확인했고 최종 소스는 동일하다. [3라운드 보고서](evaluations/2026-09-07-b5-phase1-round3-report.md) ·
[결정](decisions/2026-09-07-nested-persistence.md).

### 2026-09-07 B′5 Phase 1+7 — 4라운드 대칭 복구

`023fb74`의 비대칭을 수정했다. 타임라인·트랙·미디어·컬렉션 모두 맵에만 있으면
ID 순서로 끝에 복원하고, 순서에만 있으면 참조를 제거한다. 클립은 순서에만 있으면
참조를 제거하고, 맵에만 있으면 트랙 배치를 추측하지 않고 CRDT 키와 값을 보존한다.
스키마 2의 고아 클립도 마이그레이션 전에 v3로 옮겨 정리 과정의 삭제를 막았다.
실제 삭제 writer와 동시 이름변경이 만든 빈 타임라인·트랙을 테스트에서 단언하며,
내용 삭제가 이기는 정책을 채택하고 “복원했지만 내용은 다른 세션에서 제거됨”을 알린다.
순서 복원(스택 맨 아래 포함)·참조 제거·미배치 클립 보존·내용 삭제 알림을 구분했다.
실패한 read의 알림 상태는 폐기하고 복구 사본 이름·수정 시각과 DB 부재 시 유휴 재시도도 수정했다.
강제 마이그레이션 압축 실패 후 물리 백업이 500편집까지 남는 선택 사항은 기존 backoff를
유지하기 위해 보류했다. 고아 클립은 CRDT에는 남지만 화면과 JSON 내보내기에는 포함되지 않는다.
[10칸별 회귀 테스트·결과](evaluations/2026-09-07-b5-phase1-round4-report.md) ·
[결정](decisions/2026-09-07-nested-persistence.md).

4라운드 최종 검증: **gate 9/9 PASS**, core **162**·web **791**·desktop **72**·scripts **11**
= **1,036 테스트**(persistence **171**), 전체 E2E **68/68 두 번 PASS**(각 2.7분).
두 실행 전 32119 lsof 미사용 확인, 두 실행 사이 소스 변경 없음.

### B′5 Phase 1+7 — 5라운드 후속

`40e1c6d` 기준으로 트랙 간 중복 클립 참조는 트랙 순서상 첫 참조를 유지하고
후속 참조를 제거·알림하며, 다음 writer 저장으로 배열을 정리한다. 실제 writer로
트랙 이동 대 앞 이동·다른 트랙 이동·삭제 대 앞 이동을 양 복제본에서 재현하고
수렴 및 저장/재개방을 검증했다. 고아 클립은 `{ timelineId, clip }` 형태의
검증된 `preservedClips` JSON 필드에 담아 백업·가져오기 후 새 CRDT에서도 보존한다.
위치를 잃은 트랙 아래 클립도 포함하며 로드·JSON 내보내기 알림에 개수를 표시한다.
배치/삭제 UI는 이번 최소안 밖이고 영상 출력에는 포함되지 않는다는 한계를
알림과 결정 문서에 명시했다. A5 1,000자산/1,000클립 저장 각 300회는 기준/수정본
모두 p50 4.0ms·p95 4.5ms. [5라운드 보고서](evaluations/2026-09-07-b5-phase1-round5-report.md).

최종 `pnpm gate` **9/9 PASS**, 단위 **1,043**(core162·web798·desktop72·scripts11),
전체 E2E **68/68 두 번 PASS(2.6m·2.7m)**. 두 실행 사이 소스 변경 없음,
각 실행 전과 최종 종료 후 32119 lsof 비점유 확인.

### B′5 Phase 2 — 사이클 방어 (`97809be`, 2026-09-07)

Phase 1+7 이 시퀀스 클립을 실제 문서에 저장하기 시작했으므로, 렌더러를 건드리기 전에
방어를 먼저 넣었다. 설계 원칙은 사이클을 **막는** 것이 아니라 **생겨도 죽지 않는** 것이다.
편집 시점 검증만으로는 부족하다. CRDT 병합이 각각 합법적인 두 편집을 합쳐
사이클을 만들 수 있기 때문이다. 실제 Yjs writer 두 개로 그 상황을 만들어
문서가 예외 없이 로드되는 것을 검증했다.

신규 `packages/core/src/timeline/sequence-graph.ts` 는 반복 DFS + 강결합 요소로
O(V+E) 에 각 타임라인을 한 번만 열고 재귀 호출 스택을 쓰지 않는다.
`MAX_SEQUENCE_DEPTH = 8` 은 루트 포함 8단계를 허용하고, 내부 분석은 9번째를
초과 표지로 남겨 **합법적인 8단 연쇄와 초과를 구분**한다.
사이클·초과·누락 대상은 길이 0으로 기여한다.

삽입·트랙이동·복제·붙여넣기 네 지점이 거부 시 **원본 `Project` 를 그대로 반환**해
실행 취소·재실행 신원을 보존한다. 붙여넣기는 묶음 전체를 원자적으로 거부하고,
이동은 원본을 제거하기 전에 검증한다. 순수 `sequenceEditReason` 프리플라이트를
웹 스토어가 호출해 번역된 경고를 띄우고, 코어 변이가 같은 검사를 반복해
UI 를 거치지 않는 호출자가 우회하지 못한다. 네 경로 모두 회귀 테스트가 있다.

**누락 대상 보존 정책**: 자식 타임라인을 삭제해도 부모의 시퀀스 클립은
오프라인 미디어와 동일하게 문서에 남는다. 타임라인 ID·소스 구간·효과·배치가 보존되고
`missing-sequence` 린트가 설명한다. 대상 ID 를 되살리면 참조가 복원되며,
부모 클립 삭제는 사용자의 선택이다. 연쇄 삭제도, 린트를 통과시키기 위한
원본·문서 재작성도 하지 않는다. 새 복구 사유는 필요 없다 —
참조를 **유지**했으므로 `referencesRemoved` 는 거짓이 된다.
`preservedClips` 는 코어 `Project` 의 정식 선택 필드가 됐고,
재생 간선이 아니므로 `collectSequenceRefs` 에서 의도적으로 제외하되
린트는 되살릴 때 사이클이 되는지까지 진단한다.

`computeDuration` 은 `(Project, timelineId = rootTimelineId)` 로 바뀌었다.
프로덕션 코어 호출자는 `mutate-internal.ts` 의 `recompute` 하나뿐이고
렌더러·익스포트 루프는 이 질의를 프레임마다 부르지 않는다.

**측정으로 회귀 하나를 잡았다.** 첫 구현은 모든 변이마다 전체 그래프를 만들어
다중 타임라인 구성에서 **7.86배** 느려졌다. 시퀀스 클립이 없는 타임라인이
원래의 지역 스캔으로 빠지는 빠른 경로를 넣어 제거했다.
`0b2e55f` 의 실제 `moveClip` 을 별도 사본으로 떼어내 동일한 1,000클립 입력에서
워밍업 300회 후 2,000회 × 11배치를 구현 순서를 번갈아 실행한 중앙값 µs/호출:

| 구성 | 기준 | 첫 구현 | 최종 |
| --- | ---: | ---: | ---: |
| 타임라인 1 × 클립 1,000 | 25.816 | 25.649 | 18.625 |
| 타임라인 10 × 클립 100 | 2.942 | 23.134 | 2.041 |

최종은 기준 대비 0.80×·0.79× 로 오히려 빠르다. 옛 경로가 만들던 평탄화 임시 배열을
만들지 않기 때문이다. 검사 패널은 빈 프로젝트 0.568µs, 1,000클립 48.828µs 이며
콘텐츠 참조 비교 memo 경계 뒤에 있어 플레이헤드·줌 갱신은 그래프를 순회하지 않는다.
로컬 마이크로벤치이고 브라우저 반응성 보장이 아니다.

Claude 독립 검증 **gate 9/9 PASS**, 단위 **1,058**(core171·web804·desktop72·scripts11),
Chromium 전체 E2E **68/68**(2.8분). [게이트 표](evaluations/2026-09-07-b5-phase2-gate.md),
[결정 문서](decisions/2026-09-07-sequence-cycle-safety.md).

Phase 3·4 는 이 경계 순회 정책을 중첩 프레임·오디오 평가로 그대로 가져가야 한다
(실패 시 검은 프레임·무음).

### B′5 Phase 3 — 컴포지터 재진입 기반 (2026-09-07)

중첩 렌더링을 추가하지 않고 프리뷰·익스포트가 공유하는 컴포지터의 프레임 소유권을
분리했다. `renderFrame` 은 선택적 타깃·플레이헤드를 받고, 기본값은 기존 화면 타깃과
프로젝트 스냅샷이다. 가시성·텍스트 애니메이션·키프레임·전환·미디어 소스 시각이
같은 숫자 플레이헤드를 사용한다. 알파 소스의 managed 승격은 씬 초기화 전에
끝나므로 업로드가 진행 중인 씬을 다시 clear 하지 않는다.

PingPong 은 활성 프레임 레인별 인스턴스이고, scratch 는 `(레인, 역할)` 키와
엔트리별 크기를 사용한다. 리스된 타깃은 크기 변경·retain·축출·dispose 를 건너
살아 있고 마지막 borrower 가 놓을 때만 해제한다. source/image 예산은 모든
레인이 기존 한도를 공유하며, 자리가 없으면 부모 자원을 축출하지 않고 자식의
검은/빈 기여로 끝난다. 자식 타깃은 투명 검정, 화면 타깃은 불투명 검정이다.

명시적 타깃 렌더는 각 동기 GPU 구간에서 read/draw FBO 와 viewport 를 복원한다.
바인딩 스냅샷은 await 를 건너지 않는다. 암묵적 화면 렌더는 기존처럼 캔버스 상태를
소유하므로 매 레이어의 동기 GL 질의 비용을 내지 않는다. DOM 소스 seek·업로드·
segmentation 은 좁은 직렬 구간에 두고, Phase 4 는 그 구간 안에서 중첩 렌더를
호출하면 안 된다는 불변식을 코드와 결정 문서 양쪽에 기록했다.

검증 및 성능 최종 결과는 이 배치의 [평가 보고서](evaluations/2026-09-07-b5-phase3-report.md)에
기록한다. 기존 단위/E2E 단언은 유지하고, 수동 managed-color 감사는 코디네이터 승인하에
프레임 컨텍스트를 전달하는 픽스처 배관만 적응시켰다.
[설계 결정](decisions/2026-09-07-compositor-reentry.md).

최종 `pnpm gate` **9/9 PASS**, 단위 **1,065**(core171·web811·desktop72·scripts11),
Chromium **72/72 PASS(2.8분)**. 전체 실행 전후 727개 소스/설정 파일 해시 동일,
32119 포트 비점유. 수동 managed-color 감사도 기존 단언 그대로 PASS.
양성 대조를 붙인 GPU 비교 28종은 전체 채널 불일치 0이다.

4K 자산 1,000개와 5종 워킹셋의 정·역방향 실행 모두 검은 프레임·정상 상태
타깃 재할당·삭제·누수 0, 유지 텍스처 248,832,096바이트로 기준과 동일했다.
두 전체 실행의 시간은 순서 편향으로 반대 결론을 내므로 성능 판정에는 사용하지 않았다.
교차 짝 측정의 수정본/기준 중앙 비율은 4K영상+제목 0.9892,
4K+1080p영상 0.9798, 4K스틸3장 1.0167, 영상2개+스틸3장 1.0189,
초과크기영상+제목 1.0325. 큰 스틸 회귀는 제거했고 남은 1.7~3.3% 비용은
보고서에 명시했다. 단일 네이티브 크기 bypass 추가 측정은 영상 0.8985,
스틸 0.8222로 이 로컬 실행에서 회귀가 없었다.


### B′5 Phase 4 — 중첩 시퀀스 화면 렌더링 (2026-09-08)

문서에 저장된 시퀀스 클립의 **화면**을 재귀 렌더한다. 오디오는 Phase 5,
편집 UI 는 Phase 6 범위다. 자식 시각은 trimIn 과 기존 speed-ramp 적분으로 계산하고,
투명 RGBA8 자식 타깃을 부모의 linear 효과·합성 입력으로 변환한다.

조상 타임라인 ID 배열을 재귀 인수로 전달하고 그래프 분석 결과를 공유한다.
`MAX_SEQUENCE_DEPTH` 는 루트 포함 조상 깊이와 자식 서브트리 깊이에 적용하며,
동시 렌더 레인 번호와 분리했다. 시퀀스 분기는 미디어 전용 `withSource` 콜백
바깥에 있어 자식 미디어가 부모 소스 큐를 기다리는 데드락을 만들지 않는다.
사이클·대상 없음·깊이 초과는 예외 없이 빈 기여로 끝나며 빈 루트에서는 검정이다.

retain 은 활성 프로젝트의 모든 타임라인과 이미 할당한 유휴 자식 레인까지 포함한다.
캐시 한도를 늘리지 않고 다음 루트 프레임에서 자식 텍스처가 삭제되는 문제를 막았다.
1080p 미디어·텍스트·도형 중첩 1단/2단 각각 워밍업 후 300프레임에서
텍스처 생성·삭제, 타깃 재할당, FBO 생성·삭제가 모두 0이다.

실제 GL 픽셀 증거는 중첩 1·2단과 루트 포함 8레벨의 비검정 양성 대조,
실패 4종 검정, 투명 배경·반투명·부모 노출 효과, trim/speed 및 램프 시각,
소스 큐 대기 중 독립 렌더를 확인한다. 기존 프로젝트 28종은 Phase 3 대비
전체 채널 불일치 0이고 managed 감사의 기존 단언도 PASS다.

교차 짝 측정의 기존 프로젝트 수정본/기준 비율은 1.0022, 1.0099, 1.0071,
0.9882, 0.9566이다. 별도의 중첩 비용은 1단 p50 6.50ms
(1.2068× flat), 2단 p50 7.40ms
(1.4337× flat)다. 디코딩을 제외한 로컬 Metal 완료/readback 포함
렌더 비용이며 보편적인 GPU 성능 보장은 아니다.

`pnpm gate` **9/9 PASS**, 단위 **1,065**, Chromium **72/72 PASS**.
전체 게이트 전후 소스/설정 728개 SHA-256 동일, 포트 32119 비점유 확인.
`next-env.d.ts` 는 변경/커밋 대상에서 제외했다. 게이트 빌드가 이 추적 파일의
참조 경로를 일시적으로 `.next-gate` 로 바꾸는 기존 결함은 별도 후속 항목이다.

[평가·재현·남은 항목](evaluations/2026-09-08-b5-phase4-report.md),
[설계 결정](decisions/2026-09-08-sequence-rendering.md).

색 정밀도 후속: RGBA8 자식 경계는 일관된 premultiplied sRGB 입력 계약과
4K 타깃당 31.64MiB(16F 는 63.28MiB)의 메모리 절충으로 채택했다. 평면의
16F 중간 계조와 달리 컴파운드는 부모 처리 전에 중첩마다 8비트로 양자화하므로
노출 보정 시 밴딩이나 자식 단계 클리핑 손실이 드러날 수 있다. 선형 RGBA16F
자식 타깃·명시적 색 도메인·자식 메모리 예산을 검토하고 평면/중첩 그라데이션,
알파 램프, 자식 노출 상승 후 부모 감소를 비교할 후속 항목을 등록했다.

### B′5 Phase 5 — 중첩 시퀀스 오디오 (2026-09-08)

자식 타임라인을 로컬 트랙 게인·팬·뮤트·솔로와 클립 효과/볼륨 적용 후 스테레오로
접고, 시퀀스 시간 변환과 부모 트랙 제어를 순서대로 적용한다. 공유 코어 플랜을
내보내기·중첩 미리보기·정지 미터에서 사용하며, 중첩 PCM 미리보기는 기존 부모
Web Audio 그래프로 들어간다. 프로젝트 버스/마스터는 루트 부모에서 한 번만
적용한다. 이는 감독자와 결정한 Phase 0 버스 중복 적용 제안의 명시적 수정이다.

시퀀스 시간은 Phase 4 와 같은 `trimIn + sourceOffsetForRamp` 이고 10ms 적분
그리드도 동일하다. 자식 미디어의 B′2 피치 보존을 먼저 수행하고 부모 varispeed 를
그 위에 적용한다. 시퀀스 피치 필드/토글은 Phase 6 에 함께 추가하기로 결정했다.
자식 스트림을 부모 청크 사이에 유지해 B′2 체크포인트를 보존하며 내부 범위는
정수 샘플로 전달한다. 실패 4종은 깊이 가드로 무음이고 루트 포함 8단은 유효하다.

평면 등가·반복 인스턴스·트림/클리핑·부모 제어·동일 버스 −6dB 1회 적용·
650/845ms 동기·실제 B′2 처리 순서·미리보기 그래프 연결을 신규 테스트로 검증했다.
교차 짝 PCM 내보내기 300쌍씩 측정에서 1단/2단의 중앙 비율은 1.9751×/2.9352×,
중첩 p50 은 1.9807ms/2.8950ms 이고 모든 샘플의 평면 대비 차이는 0이다.
합성 디코드 입력 1초의 믹서 비용이며 실제 코덱/디스크 시간은 포함하지 않는다.

[평가·게이트·남은 항목](evaluations/2026-09-08-b5-phase5-report.md),
[설계 결정](decisions/2026-09-08-sequence-audio.md).

Phase 5 최종 `pnpm gate` **9/9 PASS**, 단위 **1,083**, Chromium **72/72 PASS**.
전체 실행 전후 소스/설정 731개 SHA-256 동일, 32119 포트 비점유 확인.
초기 미터 회귀는 기존 단언 그대로 수정했고 실패/중간 통과 게이트 증거도 보존했다.
자식/부모 팬 이후 실제 상수 PCM 피크와 미터 패리티, 오래된 재생 취소가 새 재생을
멈추지 않는 것, 현재 세대 오류가 전파되는 것을 추가 검증했다.
`next-env.d.ts` 는 변경/스테이징하지 않았고 merge·tag·push 는 하지 않았다.

### B′5 Phase 6A — 시퀀스 편집과 타임라인 탭 (2026-09-08)

감독자 승인으로 Phase 6을 6A(편집·탭), 6B(컴파운드 생성/해제·보존 클립 복구),
6C(시퀀스 피치 필드·DSP)로 분리했다. 6A는 기존 중첩 문서를 열어 자식을 편집하는
경로를 제공한다. 루트만 있는 프로젝트에는 탭 DOM이나 추가 레이아웃 래퍼가 없다.
활성 ID는 비영속 UI 스토어에 있고 편집 실행 취소/다시 실행은 탭을 바꾸지 않는다.

`hasSourceTrim`으로 자르기·삽입·덮어쓰기·롤·슬라이드·슬립의 미디어 게이트를
일반화했다. 슬립/소스 구간은 자식 길이를 경계로 사용한다. 편집 읽기와 프리뷰는
활성 타임라인 뷰를 사용하고 변경 결과와 히스토리는 정규 루트로 복원한다.
뷰의 루트 ID가 저장되는 사고를 막도록 spread에도 남는 표식과 JSON 직렬화 차단,
저장/CRDT/히스토리 진입점 검사를 추가했다. 캡처된 콜백 뷰도 저장할 수 없다.

한국어·영어 프로젝트 파일 가져오기→자식 탭→편집→부모 결과 확인→탭을 유지하는
실행 취소/다시 실행, 단일 타임라인 화면 유지, 768px 키보드 탐색을 E2E로 검증한다.
피치 필드와 컴파운드 생성/해제, 보존 클립 복구는 이 변경에 포함하지 않는다.
[평가·게이트·편집 게이트 전수 조사](evaluations/2026-09-08-b5-phase6a-report.md).

Phase 6A 최종 `pnpm gate` **9/9 PASS**, 단위 **1,094**, Chromium **77/77 PASS**.
최종 게이트 전후 소스/설정 661개 SHA-256이 동일하다. 첫 게이트의 지시문/import
순서 빌드 실패는 수정 후 전체 재실행했으며 초기 실패 증거도 보존했다.
`next-env.d.ts`는 최종 diff와 스테이징에서 제외했고 merge·tag·push는 하지 않았다.

### B′5 중첩 시퀀스 — 완료 (2026-09-10)

일곱 단계가 모두 main 에 들어갔다. 중첩 시퀀스가 **저장되고, 병합 충돌과 순환에서
살아남고, 화면에 그려지고, 소리가 나고, 사용자가 만들고 열고 풀 수 있다.**

| 단계 | 내용 | 커밋 |
| --- | --- | --- |
| 0 | 모델 기반 | `8f028cf` |
| 1+7 | 클립 kind + 영속화 (리뷰 5라운드) | `3ef435b` |
| 2 | 사이클 방어 | `97809be` |
| 3 | 컴포지터 재진입화 | `1feb3b5` |
| 4 | 재귀 렌더링 | `46d32a9` |
| 5 | 오디오 | `d41062d` |
| 6A | 편집 탭·트림 시맨틱 | `c00ea2c` |
| 6B | 컴파운드 만들기·해제, 보존 클립 복구 | `6256c93` |
| 6C | 시퀀스 피치 옵트인 | `382aad9` |

Phase 6A 부터는 Codex 세션이 사용량 한도로 멈춰 Claude 가 직접 구현했다.

**측정으로 잡은 회귀 두 건.** Phase 2 의 첫 구현은 모든 변이마다 전체 그래프를
다시 만들어 다중 타임라인에서 **7.86배** 느렸다. 시퀀스가 없는 타임라인이 원래 계산으로
빠지는 빠른 경로로 제거했고 최종은 기준보다 빠르다. Phase 3 은 불필요한 GL 상태 질의로
다중 스틸이 3.7→6.3ms 였고, 소유권 계약(암묵적 화면 렌더는 캔버스 상태를 소유,
명시적 타깃만 저장·복원)으로 해결했다. 무거운 구성은 1.7~3.3% 비용이 남고
**단일 클립 프리뷰 경로는 10~18% 빨라졌다.**

**측정 방법에서 배운 것.** 전체 스위트를 두 번 돌리는 방식은 순서 편향에 지배당해
정·역방향이 **정반대 결론**을 냈다. 교차 짝 측정만이 두 구현을 구분한다.
그리고 하네스가 제품이 아니라 자기 자신을 재는 경우가 세 번 있었다 —
1080p 렌더에 불가능한 0.015ms 기준값, 빈 버퍼 두 개를 비교했을 수 있는 "불일치 0",
그리고 Radix 컨텍스트 메뉴가 Playwright 에서 활성화되지 않는 문제(기존 항목으로 확인).
양성 대조와 draw 호출 수 계측으로 앞의 둘을 배제했고, 마지막은 명령 팔레트로 우회했다.

**규칙 두 개가 확정됐다.** 전체 E2E 실행 중에는 소스를 변경하지 않는다(dev 서버
hot reload 가 끼어들면 그 실행은 증거로 무효). 게이트는 `NEXT_DIST_DIR` 로 빌드하면서
추적 파일 `apps/web/next-env.d.ts` 를 다시 쓰므로 커밋 대상에서 제외한다.

남은 후속: 컴파운드 안의 8비트 색 양자화(RGBA16F 재검토),
게이트의 `next-env.d.ts` 오염, Radix 컨텍스트 메뉴 E2E 미지원.

## 도그푸딩 라운드 (2026-09-10 → 09-11, Claude 단독)

사용자가 서명 없는 arm64 DMG 를 설치해 써 보고, Claude 가 패키지 앱에서 재현해 고친 것.

| 보고 | 원인 | 커밋 |
| --- | --- | --- |
| 가져오면 "저장 실패" | 참조 가져오기가 스키마 필수 필드 `importedAt` 을 빠뜨렸고 catch 가 사유를 삼킴 | `2f1b128` |
| 타임라인 스키밍이 안 됨 | 스키머가 hover 시각을 뷰어에 전달하지 않음 | `ee7f058` |
| 색 안내 두 개가 새 프로젝트에도 뜸 | 마이그레이션 안내에 `createdAt` 게이트 없음 · WebCodecs 창이 뜨는 사이의 `<video>` 임시 프레임에서 근사 안내 발화 | `7350035` |
| 타임라인에 소리 레벨(파형)이 없음 | 참조 가져오기는 썸네일·필름스트립·파형을 만들지 않았음 | `423efb5` |
| 보관소에서 미리보기·구간 설정 요청 | 소스 뷰어 신설 (`docs/decisions/2026-09-11-source-viewer.md`) | `1f341c4` |
| 보관소 카드 위 스키밍·구간 선택, 타임라인 오디오 레벨 | 카드 훑어보기·구간 띠, 클립 위 볼륨 라인 (같은 결정 문서의 추가 절) | `39af9c8` |

카드 클릭이 타임라인에 추가하던 설계는 이 라운드에서 끝났다 — 클릭은 보기, 추가는 명시적 동작.
