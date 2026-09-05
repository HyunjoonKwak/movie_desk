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
- 2026-09-04 Claude: A4 누락 재연결·휴지통 1차(`claude/a4-relink-trash`). 재연결: 누락 배지가 붙은 OPFS 원본 자산 카드의
  "다시 연결"로 파일을 고르면 크기(없으면 이름)로 같은 미디어인지 확인하고 같은 OPFS 키에 다시 써서 클립을 그대로
  살린다. 크기가 다르면 D1 규칙대로 조용히 바꾸지 않고 차이를 보여 준 뒤 "그래도 연결"을 눌러야 한다. 재연결된
  레코드는 새 객체라 디코더 backoff·소스 상태 검사가 즉시 재시도한다. 휴지통: 삭제한 자산 레코드를 IndexedDB
  `cut_editor.trash.v1`에 30일 보관하고 media GC가 그 파일을 참조로 취급, 미디어 패널 하단 "휴지통 (n)"에서 복원·
  영구 삭제·비우기. 타임라인에서 지워진 클립은 되돌리기(⌘Z)로만 복구된다(안내 문구). 데스크톱 참조 파일(`sourceRef`
  disk)의 재연결은 카탈로그 IPC와 helper 지문 확인이 필요해 다음 배치 — 그 카드에는 재연결 버튼이 뜨지 않는다.
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
- 미디어 카드의 "썸네일 다시 만들기": 재연결 Undo 또는 손상된 파생 캐시에서 현재 원본으로 썸네일·필름스트립을
  명시적으로 재생성한다. 프리뷰 저장소 변경을 undo history에 넣기 전 이 복구 경로를 먼저 제공한다.
- 스냅샷 보존 상한: 현재는 개수·기간 제한이 없고 GC가 모든 스냅샷의 원본·프리뷰를 보존한다. 사용량 UI와 함께
  프로젝트별 개수 또는 기간 정책을 결정한 뒤, 사용자 확인 없는 자동 삭제가 되지 않도록 구현한다.
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
| A4 누락 재연결·휴지통 | Claude | 1차 구현(OPFS 원본 재연결 + 휴지통) | 데스크톱 참조 파일 재연결과 카탈로그 백업/복원은 다음 배치. e2e 3개(같은 크기 재연결, 다른 크기 확인 후 연결, 삭제→휴지통→복원) |
| C1 새 프로젝트 출발점 | Codex + Claude 검토 | 구현·교차 리뷰 완료, main 통합 | 가져오기·정리, 수동 편집, 안내형 초안의 세 출발점을 같은 전문 편집 작업 공간에 연결했다. Claude 교차 리뷰에서 찾은 미선택 새로고침·전역 드롭·키보드 포커스·모바일 검증·E2E 결합 문제를 후속 수정. `267eee2` + `8342164`, Chromium E2E 36개·Chrome HEVC·원격 CI 통과. 다음은 C2 |
| A2-a 오디오 트랙 variant | Claude + Codex | 구현·통합 검증 완료, main 통합 | AAC 트랙을 mp4box demux → mp4-muxer 재먹싱(재인코딩 없음)한 audio-only MP4를 OPFS 캐시에 저장. 재생·파형·내보내기 믹서가 variant를 읽고 없으면 원본. Codex가 동시 build 병합과 캐시 쓰기 실패 폴백을 보강. 남은 일: AAC 외 코덱(Opus·PCM), 디코드된 PCM 청크 스트리밍(B15) |
